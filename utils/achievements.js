const prisma = require("./db");

function normalizeRatingStats(stats) {
  const ratings = stats.map((s) => s.rating).filter((r) => r != null);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const count8 = ratings.filter((r) => r >= 8).length;
  const count9 = ratings.filter((r) => r >= 9).length;
  const count10 = ratings.filter((r) => r >= 10).length;
  return { avg, count8, count9, count10 };
}

async function evaluateAchievementsForPlayer(playerId) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { stats: true },
  });
  if (!player) return [];

  const { avg, count8, count9, count10 } = normalizeRatingStats(player.stats || []);

  const weeklyCount = await prisma.weeklyAward.count({
    where: { bestPlayerId: playerId },
  });
  const monthlyCount = await prisma.monthlyAward.count({
    where: { craqueId: playerId },
  });

  const achievements = await prisma.achievement.findMany();
  const existing = await prisma.playerAchievement.findMany({
    where: { playerId },
  });
  const existingMap = new Map(existing.map((pa) => [pa.achievementId, pa]));

  const newlyUnlocked = [];

  for (const ach of achievements) {
    let progress = 0;
    const target = ach.targetValue || 0;
    const pos = (player.position || "").toLowerCase();

    switch (ach.category) {
      case "gols":
        progress = player.totalGoals || 0;
        break;
      case "assistencias":
        progress = player.totalAssists || 0;
        break;
      case "presenca":
        progress = player.totalMatches || 0;
        break;
      case "zagueiro":
        // Só conta se a posição for zagueiro/defensor
        if (pos.includes("zag") || pos.includes("def")) {
          progress = player.totalMatches || 0;
        } else {
          progress = 0;
        }
        break;
      case "notas":
        if (ach.code === "nota_media_6" || ach.code === "nota_media_7") {
          progress = avg;
        } else if (ach.code === "nota_10x8") {
          progress = count8;
        } else if (ach.code === "nota_25x9") {
          progress = count9;
        } else if (ach.code === "nota_10") {
          progress = count10 > 0 ? 1 : 0;
        }
        break;
      case "premio":
        if (ach.code.startsWith("prem_semana")) progress = weeklyCount;
        else if (ach.code.startsWith("prem_mes")) progress = monthlyCount;
        else progress = weeklyCount + monthlyCount;
        break;
      default:
        progress = existingMap.get(ach.id)?.progressValue || 0;
        break;
    }

    const hasTarget = ach.isNumeric && target > 0;
    let shouldUnlock = false;
    if (ach.isNumeric) {
      shouldUnlock = hasTarget ? progress >= target : false;
    } else {
      // não numéricas: só desbloqueia manualmente; não faz auto unlock aqui
      shouldUnlock = false;
    }

    const current = existingMap.get(ach.id);
    const alreadyUnlocked = !!current?.unlockedAt;

    const data = {
      progressValue: progress,
      unlockedAt: current?.unlockedAt || null,
    };
    if (shouldUnlock) {
      if (!alreadyUnlocked) {
        data.unlockedAt = new Date();
        newlyUnlocked.push({ id: ach.id, title: ach.title, code: ach.code, category: ach.category, rarity: ach.rarity });
      }
    } else {
      data.unlockedAt = null; // reverte se não atingiu
    }

    await prisma.playerAchievement.upsert({
      where: {
        playerId_achievementId: {
          playerId,
          achievementId: ach.id,
        },
      },
      update: data,
      create: {
        playerId,
        achievementId: ach.id,
        progressValue: progress,
        unlockedAt: data.unlockedAt,
      },
    });
  }

  return newlyUnlocked;
}

async function getPlayerAchievements(playerId) {
  const achievements = await prisma.achievement.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
    include: {
      players: {
        where: { playerId },
      },
    },
  });

  return achievements.map((a) => {
    const pa = a.players[0] || null;
    return {
      id: a.id,
      code: a.code,
      title: a.title,
      description: a.description,
      category: a.category,
      rarity: a.rarity,
      targetValue: a.targetValue,
      symbol: a.symbol,
      isNumeric: a.isNumeric,
      sortOrder: a.sortOrder,
      progressValue: pa?.progressValue || 0,
      unlockedAt: pa?.unlockedAt || null,
    };
  });
}

async function getAchievementsStats() {
  const achievements = await prisma.achievement.findMany({
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  const playerCount = await prisma.player.count();
  const stats = [];

  for (const ach of achievements) {
    const unlockedCount = await prisma.playerAchievement.count({
      where: { achievementId: ach.id, unlockedAt: { not: null } },
    });
    stats.push({
      achievement: ach,
      unlockedCount,
      playerCount,
      percent: playerCount > 0 ? Math.round((unlockedCount / playerCount) * 100) : 0,
    });
  }
  return stats;
}

async function rebuildAchievementsForAllPlayers() {
  const players = await prisma.player.findMany({ select: { id: true } });
  const all = [];
  for (const p of players) {
    const newly = await evaluateAchievementsForPlayer(p.id);
    all.push(...newly);
  }
  return all;
}

module.exports = {
  evaluateAchievementsForPlayer,
  getPlayerAchievements,
  getAchievementsStats,
  rebuildAchievementsForAllPlayers,
};
