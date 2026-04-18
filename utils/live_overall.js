const prisma = require("./db");
const { computeOverallFromEntries } = require("./overall");
const { computeMatchRatingsAndAwards } = require("./match_ratings");

const DEFAULT_MATCH_WINDOW = 10;
const DEFAULT_CONCURRENCY = 4;

async function mapWithConcurrency(items, limit, mapper) {
  if (!Array.isArray(items) || !items.length) return [];

  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= items.length) break;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function buildFinalRatingsByMatch(matchIds) {
  const rows = await mapWithConcurrency(matchIds, DEFAULT_CONCURRENCY, async (matchId) => {
    try {
      const result = await computeMatchRatingsAndAwards(matchId);
      if (!result.error && result.scores && typeof result.scores.forEach === "function") {
        const map = new Map();
        result.scores.forEach((score) => {
          map.set(score.player.id, score.finalRating);
        });
        return { matchId, map };
      }
    } catch (err) {
      console.warn("Falha ao calcular notas finais para overall dinâmico:", err);
    }
    return null;
  });

  const finalRatingsByMatch = new Map();
  rows.forEach((row) => {
    if (row?.map) {
      finalRatingsByMatch.set(row.matchId, row.map);
    }
  });
  return finalRatingsByMatch;
}

async function getDynamicOverallSnapshot(options = {}) {
  const {
    playerWhere = {},
    from = null,
    to = null,
    matchWindow = DEFAULT_MATCH_WINDOW,
  } = options;

  const matchWhere = {};
  if (from && to) {
    matchWhere.playedAt = {
      gte: from,
      lt: to,
    };
  }

  const recentMatches = await prisma.match.findMany({
    where: matchWhere,
    orderBy: { playedAt: "desc" },
    take: matchWindow,
    select: {
      id: true,
      playedAt: true,
    },
  });

  const recentMatchIds = recentMatches.map((match) => match.id);
  if (!recentMatchIds.length) {
    return {
      recentMatches,
      recentMatchIds,
      entries: [],
      computed: [],
      scoreMap: new Map(),
    };
  }

  const [players, finalRatingsByMatch] = await Promise.all([
    prisma.player.findMany({
      where: playerWhere,
      include: {
        stats: {
          where: {
            matchId: { in: recentMatchIds },
          },
          include: {
            match: true,
          },
        },
      },
    }),
    buildFinalRatingsByMatch(recentMatchIds),
  ]);

  const entries = players
    .map((player) => {
      let goals = 0;
      let assists = 0;
      let matches = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      (player.stats || []).forEach((stat) => {
        if (!stat.present) return;

        goals += stat.goals || 0;
        assists += stat.assists || 0;
        matches += 1;

        const matchId = stat.match?.id;
        const finalRating = matchId && finalRatingsByMatch.get(matchId)?.get(stat.playerId);
        const effectiveRating = finalRating != null ? finalRating : stat.rating;
        if (effectiveRating != null) {
          ratingSum += effectiveRating;
          ratingCount += 1;
        }
      });

      if (matches === 0 && goals === 0 && assists === 0) {
        return null;
      }

      return {
        player,
        goals,
        assists,
        matches,
        rating: ratingCount > 0 ? ratingSum / ratingCount : 0,
      };
    })
    .filter(Boolean);

  const { computed } = computeOverallFromEntries(entries);
  const normalizedComputed = computed.map((row) => ({
    ...row,
    overallScore: Math.round(row.overall || 60),
  }));

  const scoreMap = new Map(
    normalizedComputed.map((row) => [row.player.id, row.overallScore])
  );

  return {
    recentMatches,
    recentMatchIds,
    entries,
    computed: normalizedComputed,
    scoreMap,
  };
}

module.exports = {
  DEFAULT_MATCH_WINDOW,
  getDynamicOverallSnapshot,
};
