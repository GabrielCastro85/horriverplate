// Utilidades para cálculo de overall (0-100) com pesos por posição
// Entrada esperada para cada jogador: { player, goals, assists, matches, rating }

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function getWeights(position) {
  const pos = (position || "").toLowerCase();

  // Pesos somam 1
  if (pos.includes("goleiro")) {
    return { rating: 0.55, goals: 0.05, assists: 0.1, presence: 0.3 };
  }
  if (pos.includes("zagueiro")) {
    return { rating: 0.5, goals: 0.1, assists: 0.1, presence: 0.3 };
  }
  if (pos.includes("meia")) {
    return { rating: 0.4, goals: 0.25, assists: 0.2, presence: 0.15 };
  }
  if (pos.includes("atac")) {
    return { rating: 0.35, goals: 0.35, assists: 0.2, presence: 0.1 };
  }
  return { rating: 0.45, goals: 0.25, assists: 0.15, presence: 0.15 };
}

function computeOverallFromEntries(entries) {
  const safeEntries = Array.isArray(entries) ? entries : [];

  const maxGoals = safeEntries.reduce((m, e) => Math.max(m, e.goals || 0), 0);
  const maxAssists = safeEntries.reduce((m, e) => Math.max(m, e.assists || 0), 0);
  const maxMatches = safeEntries.reduce((m, e) => Math.max(m, e.matches || 0), 0);

  const computed = safeEntries.map((e) => {
    const weights = getWeights(e.player?.position);

    const goalsNorm = maxGoals > 0 ? (e.goals || 0) / maxGoals : 0;
    const assistsNorm = maxAssists > 0 ? (e.assists || 0) / maxAssists : 0;
    const presenceNorm = maxMatches > 0 ? (e.matches || 0) / maxMatches : 0;
    const ratingNorm = (e.rating || 0) / 10; // rating já em 0-10

    const score01 =
      ratingNorm * weights.rating +
      goalsNorm * weights.goals +
      assistsNorm * weights.assists +
      presenceNorm * weights.presence;

    // Raw em 0-100
    const rawOverall = Math.round(clamp(score01, 0, 1) * 100);
    // Reescala para uma faixa mais “orgânica”: 60 (mínimo) a 95 (topo atual)
    // Isso mantém espaço para crescimento conforme novos stats forem entrando.
    const scaledOverall = Math.round(60 + (rawOverall / 100) * 35); // 60–95
    const overall = clamp(scaledOverall, 60, 95);

    return {
      ...e,
      overall,
      _calc: {
        weights,
        goalsNorm,
        assistsNorm,
        presenceNorm,
        ratingNorm,
      },
    };
  });

  return {
    computed,
    maxGoals,
    maxAssists,
    maxMatches,
  };
}

module.exports = {
  computeOverallFromEntries,
};
