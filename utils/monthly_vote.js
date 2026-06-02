const MONTHLY_VOTE_WEIGHTS = {
  goals: 0.3,
  assists: 0.2,
  rating: 0.5,
};

const MONTHLY_VOTE_MIN_MATCHES = 2;
const MONTHLY_VOTE_DEFAULT_CANDIDATES = 6;

function getMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 3, 0, 0, 0));
  return { start, end };
}

function serializeMonthlyVoteRow(row) {
  return {
    id: row.player.id,
    name: row.player.name,
    nickname: row.player.nickname || null,
    photoUrl: row.player.photoUrl || null,
    position: row.player.position || null,
    matches: row.matches,
    goals: row.goals,
    assists: row.assists,
    photos: row.photos,
    avgGoals: Number(row.avgGoals.toFixed(2)),
    avgAssists: Number(row.avgAssists.toFixed(2)),
    avgRating: Number(row.avgRating.toFixed(2)),
    score: Number(row.score.toFixed(4)),
    eligible: row.eligible,
  };
}

async function computeMonthlyVoteData(prisma, month, year, options = {}) {
  const selectedCandidateIds = Array.isArray(options.selectedCandidateIds)
    ? options.selectedCandidateIds
    : null;
  const { start, end } = getMonthRange(year, month);
  const stats = await prisma.playerStat.findMany({
    where: {
      present: true,
      match: { playedAt: { gte: start, lt: end } },
    },
    include: { player: true },
  });

  const agg = new Map();
  stats.forEach((stat) => {
    if (!agg.has(stat.playerId)) {
      agg.set(stat.playerId, {
        player: stat.player,
        matches: 0,
        goals: 0,
        assists: 0,
        ratingSum: 0,
        ratingCount: 0,
        photos: 0,
      });
    }
    const row = agg.get(stat.playerId);
    row.matches += 1;
    row.goals += stat.goals || 0;
    row.assists += stat.assists || 0;
    row.photos += stat.appearedInPhoto ? 1 : 0;
    if (stat.rating != null) {
      row.ratingSum += stat.rating;
      row.ratingCount += 1;
    }
  });

  const ranking = Array.from(agg.values())
    .map((row) => {
      const avgGoals = row.matches ? row.goals / row.matches : 0;
      const avgAssists = row.matches ? row.assists / row.matches : 0;
      const avgRating = row.ratingCount ? row.ratingSum / row.ratingCount : 0;
      const score =
        avgGoals * MONTHLY_VOTE_WEIGHTS.goals +
        avgAssists * MONTHLY_VOTE_WEIGHTS.assists +
        avgRating * MONTHLY_VOTE_WEIGHTS.rating;

      return serializeMonthlyVoteRow({
        ...row,
        avgGoals,
        avgAssists,
        avgRating,
        score,
        eligible: row.matches >= MONTHLY_VOTE_MIN_MATCHES,
      });
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.name || "").localeCompare(String(b.name || ""));
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const eligibleVoters = ranking.map((r) => r.id);
  const eligibleCandidates = ranking.filter((r) => r.eligible);
  const selectedSet = selectedCandidateIds
    ? new Set(selectedCandidateIds.map((id) => Number(id)).filter(Number.isFinite))
    : null;

  const candidates = (selectedSet
    ? eligibleCandidates.filter((r) => selectedSet.has(Number(r.id)))
    : eligibleCandidates.slice(0, MONTHLY_VOTE_DEFAULT_CANDIDATES)
  ).map((r) => ({
    id: r.id,
    name: r.name,
    nickname: r.nickname,
    photoUrl: r.photoUrl,
    matches: r.matches,
    goals: r.goals,
    assists: r.assists,
    photos: r.photos,
    avgGoals: r.avgGoals,
    avgAssists: r.avgAssists,
    avgRating: r.avgRating,
    score: r.score,
  }));

  return { candidates, eligibleVoters, ranking };
}

module.exports = {
  MONTHLY_VOTE_DEFAULT_CANDIDATES,
  MONTHLY_VOTE_MIN_MATCHES,
  MONTHLY_VOTE_WEIGHTS,
  computeMonthlyVoteData,
};
