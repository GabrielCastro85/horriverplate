// Shared admin business-logic helpers — imported by multiple sub-modules
const prisma = require("../../utils/db");
const { updatePlayerOverallAfterMatch } = require("../../utils/overall");

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

module.exports = { recomputeTotalsForPlayers, updateAllPlayersOverallAfterMatch };
