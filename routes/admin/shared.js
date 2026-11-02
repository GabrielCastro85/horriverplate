// Shared admin business-logic helpers — imported by multiple sub-modules
const prisma = require("../../utils/db");
const { updatePlayerOverallAfterMatch } = require("../../utils/overall");
const { computeMatchRatingsAndAwards } = require("../../utils/match_ratings");
const { recalculateOverallForAllPlayers } = require("../../utils/ranking");

async function recomputeTotalsForPlayers(playerIds) {
  const uniqueIds = Array.from(new Set(playerIds)).filter((id) => !!id);
  if (!uniqueIds.length) return;

  for (const id of uniqueIds) {
    const [stats, player] = await Promise.all([
      prisma.playerStat.findMany({
        where: { playerId: id },
        include: { match: true },
        orderBy: { match: { playedAt: "desc" } },
      }),
      prisma.player.findUnique({ where: { id } }),
    ]);

    let goals = 0;
    let assists = 0;
    let saves = 0;
    let matches = 0;
    let photos = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    for (const s of stats) {
      if (!s.present) continue;

      goals += s.goals || 0;
      assists += s.assists || 0;
      saves += s.saves || 0;
      matches++;
      if (s.appearedInPhoto) photos++;
      if (s.rating != null) {
        ratingSum += s.rating;
        ratingCount++;
      }
    }

    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    const overallDynamic = (player?.overallDynamic != null) ? Math.round(player.overallDynamic) : null;

    await prisma.player.update({
      where: { id },
      data: {
        totalGoals: goals,
        totalAssists: assists,
        totalSaves: saves,
        totalMatches: matches,
        totalPhotos: photos,
        totalRating: avgRating,
        overallDynamic,
        overallLastUpdated: new Date(),
      },
    });
  }
}

async function updateAllPlayersOverallAfterMatch(matchId) {
  const stats = await prisma.playerStat.findMany({
    where: { matchId, present: true },
    include: { player: true },
  });
  const ops = stats
    .filter((s) => s.player?.overallDynamic != null)
    .map((s) => {
      const newOvr = updatePlayerOverallAfterMatch(s.player.overallDynamic, s);
      return prisma.player.update({
        where: { id: s.playerId },
        data: { overallDynamic: newOvr, overallLastUpdated: new Date() },
      });
    });
  if (ops.length) await prisma.$transaction(ops);
}

// Peladas com votação encerrada, com votos e com jogador presente ainda sem nota gravada.
async function findMatchesMissingOfficialRatings({ since = null } = {}) {
  const now = new Date();
  return prisma.match.findMany({
    where: {
      ...(since ? { playedAt: { gte: since } } : {}),
      stats: { some: { present: true, rating: null } },
      voteSessions: {
        some: { tokens: { some: { ballot: { isNot: null } } } },
        none: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      },
    },
    orderBy: { playedAt: "asc" },
    select: { id: true, playedAt: true },
  });
}

// Só preenche nota vazia: nunca substitui uma nota já gravada ou lançada à mão.
async function computeMissingOfficialRatings(matchId) {
  const result = await computeMatchRatingsAndAwards(matchId);
  if (result.error || !result.publicVotes?.length) return [];

  const missing = await prisma.playerStat.findMany({
    where: { matchId, present: true, rating: null },
    select: { id: true, playerId: true },
  });
  return missing
    .map((stat) => {
      const score = result.scores.get(stat.playerId);
      return score && score.votesCount > 0
        ? { statId: stat.id, playerId: stat.playerId, matchId, rating: score.finalRating }
        : null;
    })
    .filter(Boolean);
}

async function applyOfficialRatings(rows) {
  if (!rows.length) return;
  await prisma.$transaction(
    rows.map((row) =>
      prisma.playerStat.updateMany({
        where: { id: row.statId, rating: null },
        data: { rating: row.rating },
      })
    )
  );
  await recomputeTotalsForPlayers(rows.map((row) => row.playerId));
  await recalculateOverallForAllPlayers();
}

// Grava as notas oficiais das votações encerradas, inclusive as que venceram sozinhas pelo prazo.
async function syncOfficialRatings({ since = null } = {}) {
  const matches = await findMatchesMissingOfficialRatings({ since });
  const rows = [];
  for (const match of matches) {
    rows.push(...(await computeMissingOfficialRatings(match.id)));
  }
  await applyOfficialRatings(rows);
  return { matches: matches.length, ratings: rows.length };
}

module.exports = {
  applyOfficialRatings,
  computeMissingOfficialRatings,
  findMatchesMissingOfficialRatings,
  recomputeTotalsForPlayers,
  syncOfficialRatings,
  updateAllPlayersOverallAfterMatch,
};
