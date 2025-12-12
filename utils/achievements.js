const prisma = require("./db");

function normalizeRatingStats(stats) {
  const ratings = stats.map((s) => s.rating).filter((r) => r != null);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
  const count8 = ratings.filter((r) => r >= 8).length;
  const count9 = ratings.filter((r) => r >= 9).length;
  const count10 = ratings.filter((r) => r >= 10).length;
  return { avg, count8, count9, count10 };
}

// Encontra a primeira data em que o jogador atingiu o alvo de progresso, percorrendo partidas em ordem cronológica
function findUnlockDate(stats, category, code, target, playerPosition) {
  if (!Array.isArray(stats) || !stats.length || !target) return null;
  const sorted = [...stats].sort(
    (a, b) => new Date(a.match?.playedAt || a.createdAt || 0) - new Date(b.match?.playedAt || b.createdAt || 0)
  );

  let accGoals = 0;
  let accAssists = 0;
  let accMatches = 0;
  let accRatings = 0;
  let accRatingCount = 0;
  let acc8 = 0;
  let acc9 = 0;
  let acc10 = 0;
  const isDef = (playerPosition || "").toLowerCase().includes("zag") || (playerPosition || "").toLowerCase().includes("def");

  for (const s of sorted) {
    const playedAt = s.match?.playedAt || s.createdAt || null;
    accGoals += s.goals || 0;
    accAssists += s.assists || 0;
    if (s.present) accMatches += 1;
    if (s.rating != null) {
      accRatings += s.rating;
      accRatingCount += 1;
      if (s.rating >= 8) acc8 += 1;
      if (s.rating >= 9) acc9 += 1;
      if (s.rating >= 10) acc10 += 1;
    }

    if (category === "gols" && accGoals >= target) return playedAt;
    if (category === "assistencias" && accAssists >= target) return playedAt;
    if (category === "presenca" && accMatches >= target) return playedAt;
    if (category === "zagueiro") {
      if (!isDef) return null;
      if (accMatches >= target) return playedAt;
    }

    if (category === "notas") {
      if (code === "nota_media_6" || code === "nota_media_7") {
        const avg = accRatingCount ? accRatings / accRatingCount : 0;
        if (avg >= target) return playedAt;
      } else if (code === "nota_10x8" && acc8 >= target) {
        return playedAt;
      } else if (code === "nota_25x9" && acc9 >= target) {
        return playedAt;
      } else if (code === "nota_10" && acc10 > 0) {
        return playedAt;
      }
    }
  }
  return null;
}

async function evaluateAchievementsForPlayer(playerId) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: { stats: { include: { match: true } } },
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
    let unlockDateCandidate = null;

    switch (ach.category) {
      case "gols":
        progress = player.totalGoals || 0;
        unlockDateCandidate = findUnlockDate(player.stats, "gols", ach.code, target, pos);
        break;
      case "assistencias":
        progress = player.totalAssists || 0;
        unlockDateCandidate = findUnlockDate(player.stats, "assistencias", ach.code, target, pos);
        break;
      case "presenca":
        progress = player.totalMatches || 0;
        unlockDateCandidate = findUnlockDate(player.stats, "presenca", ach.code, target, pos);
        break;
      case "zagueiro":
        // Só conta se a posição for zagueiro/defensor
        if (pos.includes("zag") || pos.includes("def")) {
          progress = player.totalMatches || 0;
          unlockDateCandidate = findUnlockDate(player.stats, "zagueiro", ach.code, target, pos);
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
        unlockDateCandidate = findUnlockDate(player.stats, "notas", ach.code, target, pos);
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
        data.unlockedAt = unlockDateCandidate || new Date();
        newlyUnlocked.push({ id: ach.id, title: ach.title, code: ach.code, category: ach.category, rarity: ach.rarity });
      } else {
        // atualiza data se não existir ou se encontrarmos uma data mais precisa/antiga
        if (unlockDateCandidate && (!data.unlockedAt || new Date(unlockDateCandidate) < new Date(data.unlockedAt))) {
          data.unlockedAt = unlockDateCandidate;
        }
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
