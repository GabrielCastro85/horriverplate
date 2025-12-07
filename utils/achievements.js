const prisma = require("./db");

async function checkAndUnlock(playerId) {
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return;

  const totals = {
    goals: player.totalGoals || 0,
    assists: player.totalAssists || 0,
    matches: player.totalMatches || 0,
    photos: player.totalPhotos || 0,
  };

  const [weeklyCount, monthlyCount, stats] = await Promise.all([
    prisma.weeklyAward.count({ where: { bestPlayerId: playerId } }),
    prisma.monthlyAward.count({ where: { craqueId: playerId } }),
    prisma.playerStat.findMany({
      where: { playerId },
      orderBy: { match: { playedAt: "desc" } },
      select: { rating: true, match: { select: { playedAt: true } }, present: true },
    }),
  ]);

  const ratings = stats.map((r) => r.rating).filter((r) => r != null);
  const avgRating =
    ratings.length > 0 ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : 0;

  const achievements = await prisma.achievement.findMany();
  const unlocked = await prisma.playerAchievement.findMany({
    where: { playerId },
    select: { achievementId: true },
  });
  const unlockedSet = new Set(unlocked.map((u) => u.achievementId));

  const toUnlock = [];

  for (const a of achievements) {
    if (unlockedSet.has(a.id)) continue;
    const c = a.criteria || {};

    switch (c.type) {
      case "total_goals":
        if (totals.goals >= c.min) toUnlock.push({ achievementId: a.id, meta: { value: totals.goals } });
        break;
      case "total_assists":
        if (totals.assists >= c.min) toUnlock.push({ achievementId: a.id, meta: { value: totals.assists } });
        break;
      case "total_matches":
        if (totals.matches >= c.min) toUnlock.push({ achievementId: a.id, meta: { value: totals.matches } });
        break;
      case "rating_goalkeeper":
        if (
          player.position === "Goleiro" &&
          totals.matches >= (c.minMatches || 0) &&
          avgRating >= (c.minAvg || 0)
        ) {
          toUnlock.push({
            achievementId: a.id,
            meta: { avgRating, matches: totals.matches },
          });
        }
        break;
      case "photos_top": {
        const top = await prisma.player.findFirst({
          orderBy: { totalPhotos: "desc" },
          select: { id: true, totalPhotos: true },
        });
        if (top && top.id === playerId && top.totalPhotos > 0) {
          toUnlock.push({ achievementId: a.id, meta: { value: top.totalPhotos } });
        }
        break;
      }
      case "weekly_awards":
        if (weeklyCount >= c.min) toUnlock.push({ achievementId: a.id, meta: { weeklyCount } });
        break;
      default:
        break;
    }
  }

  for (const item of toUnlock) {
    await prisma.playerAchievement.create({
      data: {
        playerId,
        achievementId: item.achievementId,
        meta: item.meta,
      },
    });
  }
}

module.exports = { checkAndUnlock };
