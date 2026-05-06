// Utilidades para calculo de overall (faixa 60-95) com ajuste por posicao.
// Entrada esperada para cada jogador: { player, goals, assists, saves, savesMatches, matches, rating }

const OVERALL_MIN = 60;
const OVERALL_MAX = 99;
const FULL_CONFIDENCE_MATCHES = 6;
const MIN_SAMPLE_CONFIDENCE = 0.25;

// Pesos para computeOverallFromEntries (janela últimas 10 peladas / fallback sorteador).
// Nota domina; gols por jogo normalizam dentro do grupo — não pesam excessivamente.
const POSITION_PROFILES = {
  GOL: {
    key: "GOL",
    weights: { rating: 0.80, goals: 0.00, assists: 0.08, saves: 0.12 },
    references: { goalsPerMatch: 0.15, assistsPerMatch: 0.3, savesPerMatch: 8 },
  },
  ZAG: {
    key: "ZAG",
    weights: { rating: 0.82, goals: 0.04, assists: 0.14 },
    references: { goalsPerMatch: 0.35, assistsPerMatch: 0.35 },
  },
  MEI: {
    key: "MEI",
    weights: { rating: 0.72, goals: 0.10, assists: 0.18 },
    references: { goalsPerMatch: 0.7, assistsPerMatch: 0.8 },
  },
  ATA: {
    key: "ATA",
    weights: { rating: 0.60, goals: 0.24, assists: 0.16 },
    references: { goalsPerMatch: 1.0, assistsPerMatch: 0.45 },
  },
  OUTRO: {
    key: "OUTRO",
    weights: { rating: 0.72, goals: 0.14, assists: 0.14 },
    references: { goalsPerMatch: 0.7, assistsPerMatch: 0.6 },
  },
};

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function normalizePosition(position) {
  const pos = String(position || "").trim().toLowerCase();

  if (!pos) return "OUTRO";
  if (pos === "gol" || pos.includes("goleir") || pos.includes("goal")) return "GOL";
  if (pos === "zag" || pos.includes("zagueir") || pos.includes("def")) return "ZAG";
  if (pos === "mei" || pos.includes("meia") || pos.includes("meio") || pos.includes("vol")) return "MEI";
  if (pos === "ata" || pos.includes("atac") || pos.includes("pont") || pos.includes("fwd")) return "ATA";
  return "OUTRO";
}

function getProfile(position) {
  return POSITION_PROFILES[normalizePosition(position)] || POSITION_PROFILES.OUTRO;
}

function getSampleConfidence(matches) {
  const safeMatches = Math.max(0, Number(matches) || 0);
  if (safeMatches <= 0) return 0;

  const progress =
    FULL_CONFIDENCE_MATCHES <= 1
      ? 1
      : clamp((safeMatches - 1) / (FULL_CONFIDENCE_MATCHES - 1), 0, 1);

  return clamp(
    MIN_SAMPLE_CONFIDENCE + progress * (1 - MIN_SAMPLE_CONFIDENCE),
    MIN_SAMPLE_CONFIDENCE,
    1
  );
}

function computeOverallFromEntries(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];

  const maxGoals = safeEntries.reduce((m, e) => Math.max(m, e.goals || 0), 0);
  const maxAssists = safeEntries.reduce((m, e) => Math.max(m, e.assists || 0), 0);
  const maxMatches = safeEntries.reduce((m, e) => Math.max(m, e.matches || 0), 0);
  const maxGoalsPerMatch = safeEntries.reduce((m, e) => {
    const matches = Math.max(1, Number(e.matches) || 0);
    return Math.max(m, (Number(e.goals) || 0) / matches);
  }, 0);
  const maxAssistsPerMatch = safeEntries.reduce((m, e) => {
    const matches = Math.max(1, Number(e.matches) || 0);
    return Math.max(m, (Number(e.assists) || 0) / matches);
  }, 0);
  const maxSavesPerMatch = safeEntries.reduce((m, e) => {
    const matches = Math.max(1, Number(e.savesMatches) || 0);
    return Math.max(m, (Number(e.saves) || 0) / matches);
  }, 0);

  const computed = safeEntries.map((entry) => {
    const profile = getProfile(entry.player?.position);
    const { weights, references } = profile;

    const matches = Math.max(0, Number(entry.matches) || 0);
    const goals = Math.max(0, Number(entry.goals) || 0);
    const assists = Math.max(0, Number(entry.assists) || 0);
    const saves = Math.max(0, Number(entry.saves) || 0);
    const savesMatches = Math.max(0, Number(entry.savesMatches) || 0);
    const rating = Math.max(0, Number(entry.rating) || 0);
    const baseOverall = Number.isFinite(Number(entry.player?.baseOverall))
      ? Number(entry.player.baseOverall)
      : OVERALL_MIN;

    const goalsPerMatch = matches > 0 ? goals / matches : 0;
    const assistsPerMatch = matches > 0 ? assists / matches : 0;
    const savesPerMatch = savesMatches > 0 ? saves / savesMatches : 0;

    const goalsNorm = clamp(goalsPerMatch / references.goalsPerMatch, 0, 1);
    const assistsNorm = clamp(assistsPerMatch / references.assistsPerMatch, 0, 1);
    const savesNorm =
      profile.key === "GOL" && savesMatches > 0
        ? clamp(
            Math.log1p(savesPerMatch) /
              Math.log1p(Math.max(references.savesPerMatch || 1, maxSavesPerMatch || 1)),
            0,
            1
          )
        : 0;
    const ratingNorm = clamp(rating / 10, 0, 1);
    const presenceNorm = maxMatches > 0 ? matches / maxMatches : 0;
    const sampleConfidence = getSampleConfidence(matches);

    const effectiveWeights = { ...weights };
    if (profile.key === "GOL" && savesMatches <= 0 && effectiveWeights.saves) {
      effectiveWeights.rating += effectiveWeights.saves;
      effectiveWeights.saves = 0;
    }

    const performanceScore =
      ratingNorm * effectiveWeights.rating +
      goalsNorm * effectiveWeights.goals +
      assistsNorm * effectiveWeights.assists +
      savesNorm * (effectiveWeights.saves || 0);

    const performanceOverall =
      OVERALL_MIN + clamp(performanceScore, 0, 1) * (OVERALL_MAX - OVERALL_MIN);
    const blendedOverall =
      baseOverall * (1 - sampleConfidence) + performanceOverall * sampleConfidence;
    const overall = clamp(Math.round(blendedOverall), OVERALL_MIN, OVERALL_MAX);

    return {
      ...entry,
      overall,
      _calc: {
        profile: profile.key,
        weights,
        references,
        baseOverall,
        goalsPerMatch,
        assistsPerMatch,
        savesPerMatch,
        goalsNorm,
        assistsNorm,
        savesNorm,
        ratingNorm,
        presenceNorm,
        sampleConfidence,
        performanceScore,
        performanceOverall: Number(performanceOverall.toFixed(2)),
      },
    };
  });

  return {
    computed,
    maxGoals,
    maxAssists,
    maxSavesPerMatch,
    maxMatches,
    maxGoalsPerMatch,
    maxAssistsPerMatch,
  };
}

function resolveOverallScore(player, computedOverall, fallback = 60) {
  const manual = player?.overallDynamic ?? null;
  if (manual != null && Number.isFinite(Number(manual))) {
    return Math.round(Number(manual));
  }
  if (computedOverall != null && Number.isFinite(Number(computedOverall))) {
    return Math.round(Number(computedOverall));
  }
  const base = player?.baseOverall ?? null;
  if (base != null && Number.isFinite(Number(base))) {
    return Math.round(Number(base));
  }
  return fallback;
}

function buildOverallScoreMap(computedRows) {
  const rows = Array.isArray(computedRows) ? computedRows : [];
  const map = new Map();
  rows.forEach((row) => {
    const playerId = row?.player?.id;
    if (playerId == null) return;
    map.set(playerId, resolveOverallScore(row.player, row.overall));
  });
  return map;
}

// ─── Cálculo histórico (usa TODAS as peladas do jogador) ─────────────────────
// Pesos: nota média 50%, contribuição por posição 25%, presença 15%, forma recente 10%
function calculateHistoricalOverall(player, allStats) {
  const position = normalizePosition(player?.position);
  const { references } = POSITION_PROFILES[position] || POSITION_PROFILES.OUTRO;

  const presentStats = (allStats || []).filter((s) => s.present);
  const totalMatches = presentStats.length;

  if (totalMatches === 0) return OVERALL_MIN;

  const sorted = [...presentStats].sort((a, b) => {
    const da = a.match?.playedAt ? new Date(a.match.playedAt).getTime() : 0;
    const db = b.match?.playedAt ? new Date(b.match.playedAt).getTime() : 0;
    return db - da;
  });

  let goals = 0, assists = 0, saves = 0, ratingSum = 0, ratingCount = 0;
  for (const s of presentStats) {
    goals   += s.goals   || 0;
    assists += s.assists || 0;
    saves   += s.saves   || 0;
    if (s.rating != null) { ratingSum += s.rating; ratingCount++; }
  }

  const avgRating      = ratingCount > 0 ? ratingSum / ratingCount : 5;
  const goalsPerMatch  = goals   / totalMatches;
  const assistsPerMatch= assists / totalMatches;
  const savesPerMatch  = saves   / totalMatches;

  // Forma recente: últimas 5 peladas
  let recentSum = 0, recentCount = 0;
  for (const s of sorted.slice(0, 5)) {
    if (s.rating != null) { recentSum += s.rating; recentCount++; }
  }
  const recentRating = recentCount > 0 ? recentSum / recentCount : avgRating;

  // Normalização (per-game, contra referência por posição)
  const ratingNorm  = clamp(avgRating    / 10, 0, 1);
  const recentNorm  = clamp(recentRating / 10, 0, 1);
  const goalsNorm   = clamp(goalsPerMatch   / (references.goalsPerMatch   || 1), 0, 1);
  const assistsNorm = clamp(assistsPerMatch / (references.assistsPerMatch || 1), 0, 1);

  // Presença: 12+ peladas = regularidade máxima
  const presenceScore = clamp(totalMatches / 12, 0, 1);

  // Pesos explícitos por posição (total = 1.0).
  // ZAG e GOL redistribuem o peso ofensivo não usado para nota, evitando punição por poucos gols.
  const w =
    position === "ATA"   ? { rating: 0.60, goals: 0.09, assists: 0.06, presence: 0.15, recent: 0.10 }
    : position === "MEI" ? { rating: 0.60, goals: 0.05, assists: 0.10, presence: 0.15, recent: 0.10 }
    : position === "ZAG" ? { rating: 0.69, goals: 0.02, assists: 0.04, presence: 0.15, recent: 0.10 }
    : position === "GOL" ? { rating: 0.74, goals: 0.00, assists: 0.01, presence: 0.15, recent: 0.10 }
    :                      { rating: 0.60, goals: 0.07, assists: 0.08, presence: 0.15, recent: 0.10 };

  const performanceScore =
    ratingNorm    * w.rating   +
    goalsNorm     * w.goals    +
    assistsNorm   * w.assists  +
    presenceScore * w.presence +
    recentNorm    * w.recent;
  const performanceOverall = OVERALL_MIN + clamp(performanceScore, 0, 1) * (OVERALL_MAX - OVERALL_MIN);

  const sampleConf = getSampleConfidence(totalMatches);
  const baseOv = Number.isFinite(Number(player?.baseOverall)) ? Number(player.baseOverall) : OVERALL_MIN;

  return clamp(Math.round(baseOv * (1 - sampleConf) + performanceOverall * sampleConf), OVERALL_MIN, OVERALL_MAX);
}

// ─── Ajuste incremental pós-pelada ──────────────────────────────────────────
// Aplica delta de -2 a +2 sobre o OVR atual com base na nota da partida.
function updatePlayerOverallAfterMatch(currentOvr, matchStat) {
  const safe = clamp(Math.round(Number.isFinite(currentOvr) ? currentOvr : OVERALL_MIN), OVERALL_MIN, OVERALL_MAX);
  const rating = matchStat?.rating;
  if (rating == null) return safe;

  let delta = 0;
  if      (rating < 5.5) delta = -2;
  else if (rating < 6.5) delta = -1;
  else if (rating < 7.5) delta =  0;
  else if (rating < 8.5) delta = +1;
  else                   delta = +2;

  return clamp(safe + delta, OVERALL_MIN, OVERALL_MAX);
}

module.exports = {
  computeOverallFromEntries,
  resolveOverallScore,
  buildOverallScoreMap,
  calculateHistoricalOverall,
  updatePlayerOverallAfterMatch,
};
