// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// ==============================
// Helpers
// ==============================
function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// ==============================
// HOME /
// ==============================
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();

    // ------------------------------
    // Craque do mês (último cadastrado)
    // ------------------------------
    const monthlyCraque = await prisma.monthlyAward.findFirst({
      orderBy: [
        { year: "desc" },
        { month: "desc" },
      ],
      include: {
        craque: true,
      },
    });

    let monthlyStats = null;

    if (monthlyCraque && monthlyCraque.craqueId) {
      const { month, year } = monthlyCraque;

      // início e fim do mês referente ao prêmio
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      monthStart.setHours(0, 0, 0, 0);
      monthEnd.setHours(23, 59, 59, 999);

      const stats = await prisma.playerStat.findMany({
        where: {
          playerId: monthlyCraque.craqueId,
          match: {
            playedAt: {
              gte: monthStart,
              lte: monthEnd,
            },
          },
        },
      });

      let goals = 0;
      let assists = 0;
      let matches = 0;
      let photos = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      stats.forEach((s) => {
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.present) matches++;
        if (s.appearedInPhoto) photos++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      });

      monthlyStats = {
        goals,
        assists,
        matches,
        photos,
        avgRating: ratingCount > 0 ? ratingSum / ratingCount : 0,
      };
    }

    // ------------------------------
    // Craque / Time da semana (último WeeklyAward)
    // ------------------------------
    const weeklyAward = await prisma.weeklyAward.findFirst({
      orderBy: { weekStart: "desc" },
      include: {
        bestPlayer: true,
        winningMatch: true,
      },
    });

    // Stats da semana do craque da semana
    let weeklyStats = null;
    if (weeklyAward && weeklyAward.bestPlayerId) {
      const weekStart = startOfDay(weeklyAward.weekStart);
      const weekEnd = endOfDay(
        new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
      );

      const stats = await prisma.playerStat.findMany({
        where: {
          playerId: weeklyAward.bestPlayerId,
          match: {
            playedAt: {
              gte: weekStart,
              lte: weekEnd,
            },
          },
        },
      });

      let goals = 0;
      let assists = 0;
      let matches = 0;
      let photos = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      stats.forEach((s) => {
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.present) matches++;
        if (s.appearedInPhoto) photos++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      });

      weeklyStats = {
        goals,
        assists,
        matches,
        photos,
        avgRating: ratingCount > 0 ? ratingSum / ratingCount : 0,
      };
    }

    // ------------------------------
    // Rankings rápidos (usando campos totais do Player)
    // ------------------------------
    const topScorers = await prisma.player.findMany({
      orderBy: { totalGoals: "desc" },
      take: 10,
    });

    const topAssists = await prisma.player.findMany({
      orderBy: { totalAssists: "desc" },
      take: 10,
    });

    const topRatings = await prisma.player.findMany({
      where: {
        totalRating: {
          gt: 0,
        },
      },
      orderBy: { totalRating: "desc" },
      take: 10,
    });

    const photoKings = await prisma.player.findMany({
      orderBy: { totalPhotos: "desc" },
      take: 10,
    });

    // ------------------------------
    // Elenco (para "Elenco em destaque")
    // ------------------------------
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    // ------------------------------
    // Últimas peladas
    // ------------------------------
    const recentMatches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      take: 10,
    });

    res.render("index", {
      title: "Home",
      activePage: "home",

      monthlyCraque,
      monthlyStats,
      weeklyAward,
      weeklyStats,

      topScorers,
      topAssists,
      topRatings,
      photoKings,

      players,
      recentMatches,
    });
  } catch (err) {
    console.error("Erro ao carregar home:", err);
    res.status(500).send("Erro ao carregar a página inicial.");
  }
});

// ==============================
// PÁGINA PÚBLICA DE UMA PELADA
// GET /matches/:id
// ==============================
router.get("/matches/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(404).render("404");
    }

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: true },
          orderBy: {
            player: { name: "asc" },
          },
        },
      },
    });

    if (!match) {
      return res.status(404).render("404");
    }

    res.render("match_public", {
      title: "Estatísticas da pelada",
      activePage: "home",
      match,
      stats: match.stats || [],
    });
  } catch (err) {
    console.error("Erro ao carregar pelada pública:", err);
    res.status(500).send("Erro ao carregar estatísticas da pelada.");
  }
});

module.exports = router;
