const express = require("express");
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");

const router = express.Router();

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(404).send("Jogador não encontrado");

    const player = await prisma.player.findUnique({
      where: { id },
      include: {
        stats: { include: { match: true }, orderBy: { match: { playedAt: "desc" } } },
        achievements: { include: { achievement: true }, orderBy: { unlockedAt: "desc" } },
        overallHistory: {
          orderBy: { calculatedAt: "desc" },
          take: 12,
        },
      },
    });

    if (!player) return res.status(404).send("Jogador não encontrado");

    // Pega o overall calculado no mesmo período padrão do ranking (ano atual)
    const currentYear = new Date().getFullYear();
    const from = new Date(currentYear, 0, 1);
    const to = new Date(currentYear + 1, 0, 1);

    const playersForOverall = await prisma.player.findMany({
      include: {
        stats: {
          where: {
            match: {
              playedAt: {
                gte: from,
                lt: to,
              },
            },
          },
        },
      },
    });

    const overallEntries = playersForOverall.map((p) => {
      let goals = 0;
      let assists = 0;
      let matches = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      for (const s of p.stats) {
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.present) matches++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      }

      const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

      return {
        player: p,
        goals,
        assists,
        matches,
        rating,
      };
    });

    const { computed: rankingOverallComputed } = computeOverallFromEntries(overallEntries);
    const rankingOverallMap = new Map(rankingOverallComputed.map((o) => [o.player.id, o.overall]));

    const totals = {
      goals: player.totalGoals || 0,
      assists: player.totalAssists || 0,
      matches: player.totalMatches || 0,
      photos: player.totalPhotos || 0,
    };

    const ratingsSeries = player.stats
      .filter((s) => s.rating != null)
      .map((s) => ({
        date: s.match?.playedAt,
        rating: s.rating,
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const avgRating =
      ratingsSeries.length > 0
        ? ratingsSeries.reduce((sum, r) => sum + (r.rating || 0), 0) / ratingsSeries.length
        : 0;

    const goalsByMonthMap = {};
    player.stats.forEach((s) => {
      const d = new Date(s.match?.playedAt || Date.now());
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      goalsByMonthMap[key] = (goalsByMonthMap[key] || 0) + (s.goals || 0);
    });
    const goalsByMonth = Object.entries(goalsByMonthMap)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => new Date(a.label + "-01") - new Date(b.label + "-01"))
      .slice(-12); // últimos 12 meses

    const recentMatches = player.stats.slice(0, 8).map((s) => ({
      date: s.match?.playedAt,
      desc: s.match?.description,
      goals: s.goals,
      assists: s.assists,
      rating: s.rating,
      present: s.present,
    }));

    const overallHistory = player.overallHistory || [];
    let latestOverall =
      rankingOverallMap.get(player.id) ??
      (overallHistory.length ? overallHistory[0].overall : null);
    const overallSeries = overallHistory
      .slice(0, 12)
      .map((o) => ({ date: o.calculatedAt, overall: o.overall }))
      .reverse();

    if (latestOverall == null) {
      const { computed } = computeOverallFromEntries([
        {
          player,
          goals: totals.goals,
          assists: totals.assists,
          matches: totals.matches,
          rating: avgRating,
        },
      ]);
      latestOverall = computed && computed.length ? computed[0].overall : 0;
    }

    res.render("player_profile", {
      title: player.name,
      activePage: "elenco",
      player,
      totals,
      ratingsSeries,
      goalsByMonth,
      recentMatches,
      achievements: player.achievements,
      overallHistory,
      latestOverall,
      overallSeries,
    });
  } catch (err) {
    console.error("Erro ao carregar perfil do jogador:", err);
    return res.status(500).send("Erro ao carregar perfil do jogador.");
  }
});

module.exports = router;
