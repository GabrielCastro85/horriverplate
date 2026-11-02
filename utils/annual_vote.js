// Votação dos melhores do ano: melhor do ano + melhor de cada posição.
const { MONTHLY_VOTE_WEIGHTS, buildFinalRatingsByMatch } = require("./monthly_vote");
const { attachSelectionPhotos } = require("./monthly_selection");
const { normalizePositionGroup } = require("./weekly_selection");

const ANNUAL_BEST_CATEGORY = "MELHOR_JOGADOR";

// limit: quantos concorrem. selectionCount: quantos entram na seleção do ano.
const ANNUAL_POSITIONS = [
  { key: "GOL", label: "Melhor goleiro", groupLabel: "Goleiros", limit: 3, selectionCount: 1, awardCategory: "MELHOR_GOLEIRO" },
  { key: "ZAG", label: "Melhor zagueiro", groupLabel: "Zagueiros", limit: 10, selectionCount: 2, awardCategory: "MELHOR_ZAGUEIRO" },
  { key: "MEI", label: "Melhor meia", groupLabel: "Meias", limit: 10, selectionCount: 2, awardCategory: "MELHOR_MEIA" },
  { key: "ATA", label: "Melhor atacante", groupLabel: "Atacantes", limit: 10, selectionCount: 2, awardCategory: "MELHOR_ATACANTE" },
];

// Corte da sugestão de linha, para quem foi a poucas peladas não entrar só pela média.
const ANNUAL_VOTE_MIN_MATCHES = 8;

const ANNUAL_STAT_AWARDS = [
  { category: "ARTILHEIRO", label: "Artilheiro", field: "goals", unit: "gols" },
  { category: "ASSISTENTE", label: "Assistente", field: "assists", unit: "assistências" },
  { category: "REI_DAS_FOTOS", label: "Rei das fotos", field: "photos", unit: "fotos" },
];

function getYearRange(year, cutoff = null) {
  const start = new Date(Date.UTC(year, 0, 1, 3, 0, 0, 0));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1, 3, 0, 0, 0));
  const end = cutoff && cutoff < yearEnd ? cutoff : yearEnd;
  return { start, end };
}

async function loadYearStats(prisma, year, cutoff) {
  const { start, end } = getYearRange(year, cutoff);
  return prisma.playerStat.findMany({
    where: {
      present: true,
      match: { playedAt: { gte: start, lt: end } },
    },
    select: {
      matchId: true,
      playerId: true,
      goals: true,
      assists: true,
      rating: true,
      appearedInPhoto: true,
      player: { select: { id: true, name: true, nickname: true, position: true } },
    },
  });
}

function aggregateStats(stats, getRating = (stat) => stat.rating) {
  const rows = new Map();
  stats.forEach((stat) => {
    if (!rows.has(stat.playerId)) {
      rows.set(stat.playerId, {
        id: stat.player.id,
        name: stat.player.name,
        nickname: stat.player.nickname || null,
        position: stat.player.position || null,
        group: normalizePositionGroup(stat.player.position),
        matches: 0,
        goals: 0,
        assists: 0,
        photos: 0,
        ratingSum: 0,
        ratingCount: 0,
      });
    }
    const row = rows.get(stat.playerId);
    const rating = getRating(stat);
    row.matches += 1;
    row.goals += stat.goals || 0;
    row.assists += stat.assists || 0;
    row.photos += stat.appearedInPhoto ? 1 : 0;
    if (rating != null) {
      row.ratingSum += rating;
      row.ratingCount += 1;
    }
  });
  return Array.from(rows.values());
}

// Ranking do ano com a mesma fórmula do mês e as notas oficiais de cada pelada.
async function computeAnnualRanking(prisma, year) {
  const stats = await loadYearStats(prisma, year);
  const matchIds = Array.from(new Set(stats.map((stat) => stat.matchId)));
  const finalRatingsByMatch = await buildFinalRatingsByMatch(prisma, matchIds);

  return aggregateStats(stats, (stat) => {
    const finalRatings = finalRatingsByMatch.get(stat.matchId);
    return finalRatings && finalRatings.has(stat.playerId)
      ? finalRatings.get(stat.playerId)
      : stat.rating;
  })
    .map(({ ratingSum, ratingCount, ...row }) => {
      const avgRating = ratingCount ? ratingSum / ratingCount : 0;
      const score =
        (row.goals / row.matches) * MONTHLY_VOTE_WEIGHTS.goals +
        (row.assists / row.matches) * MONTHLY_VOTE_WEIGHTS.assists +
        avgRating * MONTHLY_VOTE_WEIGHTS.rating;
      return {
        ...row,
        avgRating: Number(avgRating.toFixed(2)),
        score: Number(score.toFixed(4)),
      };
    })
    .sort((a, b) => b.score - a.score || compareNames(a, b));
}

function compareNames(a, b) {
  return String(a.name || "").localeCompare(String(b.name || ""), "pt-BR");
}

// Goleiros: os que mais jogaram no ano. Linha: maior score com o mínimo de jogos.
function suggestCandidateIds(ranking) {
  const ids = [];
  ANNUAL_POSITIONS.forEach((position) => {
    const rows = ranking.filter((row) => row.group === position.key);
    const suggested =
      position.key === "GOL"
        ? [...rows].sort((a, b) => b.matches - a.matches || b.score - a.score)
        : rows.filter((row) => row.matches >= ANNUAL_VOTE_MIN_MATCHES);
    suggested.slice(0, position.limit).forEach((row) => ids.push(row.id));
  });
  return ids;
}

// Retorna o snapshot por posição, ou a posição que passou do limite.
function buildAnnualCandidates(ranking, selectedIds) {
  const selected = new Set(selectedIds.map(Number));
  const candidates = {};
  let overLimit = null;

  ANNUAL_POSITIONS.forEach((position) => {
    const rows = ranking.filter((row) => row.group === position.key && selected.has(row.id));
    if (rows.length > position.limit) overLimit = overLimit || position;
    candidates[position.key] = rows.map(({ group, ...row }) => row);
  });

  return { candidates, overLimit };
}

function hasAnnualCandidates(candidates) {
  return ANNUAL_POSITIONS.some((position) => (candidates?.[position.key] || []).length > 0);
}

function getAnnualVoteStatus(session, now = new Date()) {
  if (!session) return "none";
  if (now < new Date(session.opensAt)) return "scheduled";
  if (now >= new Date(session.expiresAt)) return "closed";
  return "open";
}

// Opções do eleitor: ninguém vota em si mesmo.
function getAnnualBallotGroups(candidates, voterId) {
  return ANNUAL_POSITIONS.map((position) => ({
    ...position,
    options: (candidates?.[position.key] || []).filter(
      (candidate) => Number(candidate.id) !== Number(voterId)
    ),
  })).filter((group) => group.options.length > 0);
}

// Quem recebeu o voto para melhor do ano não pode receber o voto na posição.
function parseAnnualBallot(body = {}, groups = []) {
  const bestId = Number(body.bestPlayerId);
  const allOptions = groups.flatMap((group) => group.options);
  const best = allOptions.find((option) => Number(option.id) === bestId);
  const selectedByCategory = { [ANNUAL_BEST_CATEGORY]: best ? bestId : null };
  const picks = [];
  let error = best ? null : "Escolha o melhor do ano.";

  if (best) picks.push({ category: ANNUAL_BEST_CATEGORY, playerId: bestId });

  groups.forEach((group) => {
    const playerId = Number(body[`position_${group.key}`]);
    const isValid = group.options.some((option) => Number(option.id) === playerId);
    const remaining = group.options.filter((option) => Number(option.id) !== bestId);
    selectedByCategory[group.key] = isValid && playerId !== bestId ? playerId : null;

    if (!remaining.length) return;
    if (best && playerId === bestId) {
      error = error || `${best.name} já recebeu seu voto de melhor do ano. Escolha outro jogador em ${group.label}.`;
      return;
    }
    if (!isValid) {
      error = error || `Escolha um jogador em ${group.label}.`;
      return;
    }
    picks.push({ category: group.key, playerId });
  });

  return { picks, selectedByCategory, error };
}

function rankByVotes(rows, counts) {
  return rows
    .map((row) => ({ ...row, votes: counts.get(row.id) || 0 }))
    .sort((a, b) => b.votes - a.votes || (b.score || 0) - (a.score || 0) || compareNames(a, b));
}

function isTiedAtTop(ranked, field = "votes") {
  return ranked.length > 1 && ranked[0][field] > 0 && ranked[0][field] === ranked[1][field];
}

// Apuração: votos decidem; empate vai para o score do ano.
async function computeAnnualVoteResult(prisma, session) {
  const picks = await prisma.annualVotePick.findMany({
    where: { token: { sessionId: session.id } },
    select: { category: true, playerId: true },
  });

  const countsByCategory = new Map();
  picks.forEach((pick) => {
    if (!countsByCategory.has(pick.category)) countsByCategory.set(pick.category, new Map());
    const counts = countsByCategory.get(pick.category);
    counts.set(pick.playerId, (counts.get(pick.playerId) || 0) + 1);
  });
  const countsFor = (category) => countsByCategory.get(category) || new Map();

  const candidates = session.candidates || {};
  const best = rankByVotes(
    ANNUAL_POSITIONS.flatMap((position) => candidates[position.key] || []),
    countsFor(ANNUAL_BEST_CATEGORY)
  );
  const positions = ANNUAL_POSITIONS.map((position) => {
    const ranked = rankByVotes(candidates[position.key] || [], countsFor(position.key));
    return {
      ...position,
      ranked,
      tied: isTiedAtTop(ranked),
      selection: ranked.filter((row) => row.votes > 0).slice(0, position.selectionCount),
    };
  });

  await attachSelectionPhotos(prisma, [...best, ...positions.flatMap((position) => position.ranked)]);
  return { best, bestTied: isTiedAtTop(best), positions, hasVotes: picks.length > 0 };
}

// Prêmios decididos pelos números, sem contar peladas depois do fim da votação.
async function computeAnnualStatLeaders(prisma, year, cutoff) {
  const rows = aggregateStats(await loadYearStats(prisma, year, cutoff));

  return ANNUAL_STAT_AWARDS.map((award) => {
    const ranked = rows
      .filter((row) => row[award.field] > 0)
      .sort((a, b) => b[award.field] - a[award.field] || a.matches - b.matches || compareNames(a, b))
      .slice(0, 3);
    return { ...award, ranked, tied: isTiedAtTop(ranked, award.field) };
  });
}

function buildSeasonAwards(result, statLeaders) {
  const winners = [
    { category: ANNUAL_BEST_CATEGORY, row: result.best[0]?.votes > 0 ? result.best[0] : null },
    ...result.positions.map((position) => ({
      category: position.awardCategory,
      row: position.ranked[0]?.votes > 0 ? position.ranked[0] : null,
    })),
    ...statLeaders.map((award) => ({ category: award.category, row: award.ranked[0] || null })),
  ];
  return winners
    .filter((winner) => winner.row)
    .map((winner) => ({ category: winner.category, playerId: winner.row.id }));
}

module.exports = {
  ANNUAL_BEST_CATEGORY,
  ANNUAL_POSITIONS,
  ANNUAL_VOTE_MIN_MATCHES,
  buildAnnualCandidates,
  buildSeasonAwards,
  computeAnnualRanking,
  computeAnnualStatLeaders,
  computeAnnualVoteResult,
  getAnnualBallotGroups,
  getAnnualVoteStatus,
  hasAnnualCandidates,
  parseAnnualBallot,
  suggestCandidateIds,
};
