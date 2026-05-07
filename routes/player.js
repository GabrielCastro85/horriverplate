const express = require("express");
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");
const { getDynamicOverallSnapshot } = require("../utils/live_overall");
const { evaluateAchievementsForPlayer } = require("../utils/achievements");

const router = express.Router();

async function buildPlayerProfileViewModel(req, id) {
  const player = await prisma.player.findUnique({
    where: { id },
    include: {
      stats: { include: { match: true }, orderBy: { match: { playedAt: "desc" } } },
      overallHistory: {
        orderBy: { calculatedAt: "desc" },
        take: 12,
      },
    },
  });

  if (!player) return null;

  const { scoreMap: rankingOverallMap } = await getDynamicOverallSnapshot();

  const totals = {
    goals: player.totalGoals || 0,
    assists: player.totalAssists || 0,
    matches: player.totalMatches || 0,
    photos: player.totalPhotos || 0,
  };

  const ratingsSeries = player.stats
    .filter((s) => s.present && s.rating != null)
    .map((s) => ({
      date: s.match?.playedAt,
      rating: s.rating,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const goalsByMonthMap = {};
  player.stats.forEach((s) => {
    if (!s.present) return;

    const d = new Date(s.match?.playedAt || Date.now());
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    goalsByMonthMap[key] = (goalsByMonthMap[key] || 0) + (s.goals || 0);
  });

  const goalsByMonth = Object.entries(goalsByMonthMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => new Date(a.label + "-01") - new Date(b.label + "-01"))
    .slice(-12);

  const recentMatches = player.stats
    .filter((s) => s.present)
    .slice(0, 8)
    .map((s) => ({
      date: s.match?.playedAt,
      desc: s.match?.description,
      goals: s.goals,
      assists: s.assists,
      rating: s.rating,
      present: s.present,
    }));

  const overallHistory = player.overallHistory || [];

  let syntheticOverallSeries = [];
  if (!overallHistory.length && player.stats && player.stats.length) {
    const chronoStats = [...player.stats]
      .filter((s) => s.match?.playedAt)
      .sort((a, b) => new Date(a.match.playedAt) - new Date(b.match.playedAt));

    let g = 0;
    let a = 0;
    let m = 0;
    let rSum = 0;
    let rCount = 0;

    chronoStats.forEach((s) => {
      if (!s.present) return;

      g += s.goals || 0;
      a += s.assists || 0;
      m += 1;
      if (s.rating != null) {
        rSum += s.rating;
        rCount += 1;
      }

      const avgR = rCount ? rSum / rCount : 0;
      const { computed } = computeOverallFromEntries([
        {
          player,
          goals: g,
          assists: a,
          matches: m,
          rating: avgR,
        },
      ]);

      if (computed && computed.length) {
        syntheticOverallSeries.push({
          date: s.match.playedAt,
          overall: computed[0].overall,
        });
      }
    });
  }

  let overallSeries =
    overallHistory.length > 0
      ? overallHistory
          .slice(0, 12)
          .map((o) => ({ date: o.calculatedAt, overall: o.overall }))
          .reverse()
      : syntheticOverallSeries;

  let latestOverall =
    rankingOverallMap.get(player.id) ??
    (overallSeries.length ? overallSeries[overallSeries.length - 1].overall : null);

  if (latestOverall == null) {
    latestOverall = Math.round(player.baseOverall || 60);
  }

  if (!overallSeries.length && latestOverall != null) {
    overallSeries = [{ date: new Date(), overall: latestOverall }];
  }

  // OVR trend: compare last 2 entries in the series
  let ovrTrend = "stable"; // 'up' | 'down' | 'stable'
  let ovrDelta = 0;
  const _ovrLen = overallSeries.length;
  if (_ovrLen >= 2) {
    const _curr = overallSeries[_ovrLen - 1].overall;
    const _prev = overallSeries[_ovrLen - 2].overall;
    ovrDelta = Math.round(_curr - _prev);
    if (ovrDelta > 0) ovrTrend = "up";
    else if (ovrDelta < 0) ovrTrend = "down";
  }

  await evaluateAchievementsForPlayer(id);

  const achievements = await prisma.playerAchievement.findMany({
    where: { playerId: id, unlockedAt: { not: null } },
    include: { achievement: true },
    orderBy: [
      { unlockedAt: "desc" },
      { achievement: { rarity: "desc" } },
    ],
  });

  const pos = (player.position || "").toLowerCase();
  const achievementsFiltered = achievements.filter((pa) => {
    const cat = (pa.achievement?.category || "").toLowerCase();
    if (cat === "zagueiro" && !(pos.includes("zag") || pos.includes("def"))) {
      return false;
    }
    return true;
  });

  const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
  const playerImagePath = player.photoUrl || "/img/logo.jpg";
  const playerImageUrl = `${baseUrl}${req.app.locals.thumbUrl(playerImagePath, 1200)}`;
  const descParts = [
    `Jogador ${player.name}.`,
    player.position ? `Posicao ${player.position}.` : null,
    `Gols ${totals.goals}, assistencias ${totals.assists}, presencas ${totals.matches}.`,
  ].filter(Boolean);

  return {
    player,
    totals,
    ratingsSeries,
    goalsByMonth,
    recentMatches,
    achievements: achievementsFiltered,
    overallHistory,
    latestOverall,
    overallSeries,
    ovrTrend,
    ovrDelta,
    metaDescription: descParts.join(" "),
    metaImage: playerImageUrl,
    ogTitle: `${player.name} | Horriver Plate`,
  };
}

router.get("/:id/modal", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(404).send("Jogador não encontrado");

    const profileViewModel = await buildPlayerProfileViewModel(req, id);
    if (!profileViewModel) return res.status(404).send("Jogador não encontrado");

    return res.render("player_profile", {
      layout: false,
      title: profileViewModel.player.name,
      activePage: "elenco",
      modalMode: true,
      ...profileViewModel,
    });
  } catch (err) {
    console.error("Erro ao carregar modal do jogador:", err);
    return res.status(500).send("Erro ao carregar perfil do jogador.");
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(404).send("Jogador não encontrado");

    const profileViewModel = await buildPlayerProfileViewModel(req, id);
    if (!profileViewModel) return res.status(404).send("Jogador não encontrado");

    res.locals.metaDescription = profileViewModel.metaDescription;
    res.locals.metaImage = profileViewModel.metaImage;
    res.locals.ogTitle = profileViewModel.ogTitle;

    return res.render("player_profile", {
      title: profileViewModel.player.name,
      activePage: "elenco",
      ...profileViewModel,
    });
  } catch (err) {
    console.error("Erro ao carregar perfil do jogador:", err);
    return res.status(500).send("Erro ao carregar perfil do jogador.");
  }
});

module.exports = router;
