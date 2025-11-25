// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// ==============================
// Helpers de datas
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

    // Janela em que o carrossel da temporada aparece na home
    // (29/11/2024 às 15h até 31/12/2024 23:59:59 - horário local do servidor)
    const highlightStart = new Date(2024, 10, 29, 15, 0, 0); // 29/11 (mês 10)
    const highlightEnd = new Date(2024, 11, 31, 23, 59, 59, 999); // 31/12
    const showSeasonHighlight =
      now.getTime() >= highlightStart.getTime() &&
      now.getTime() <= highlightEnd.getTime();

    // =====================================================
    // CRAQUE DO MÊS
    // =====================================================
    const monthlyCraque = await prisma.monthlyAward.findFirst({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { craque: true },
    });

    let monthlyStats = null;
    if (monthlyCraque?.craqueId) {
      const { month, year } = monthlyCraque;
      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      monthStart.setHours(0, 0, 0, 0);
      monthEnd.setHours(23, 59, 59, 999);

      const stats = await prisma.playerStat.findMany({
        where: {
          playerId: monthlyCraque.craqueId,
          match: {
            playedAt: { gte: monthStart, lte: monthEnd },
          },
        },
      });

      let goals = 0,
        assists = 0,
        matches = 0,
        photos = 0,
        ratingSum = 0,
        ratingCount = 0;

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
        avgRating: ratingCount ? ratingSum / ratingCount : 0,
      };
    }

    // =====================================================
    // CRAQUE / TIME DA SEMANA
    // =====================================================
    const weeklyAward = await prisma.weeklyAward.findFirst({
      orderBy: { weekStart: "desc" },
      include: {
        bestPlayer: true,
        winningMatch: true,
      },
    });

    let weeklyStats = null;
    if (weeklyAward?.bestPlayerId) {
      const weekStart = startOfDay(weeklyAward.weekStart);
      const weekEnd = endOfDay(
        new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
      );

      const stats = await prisma.playerStat.findMany({
        where: {
          playerId: weeklyAward.bestPlayerId,
          match: {
            playedAt: { gte: weekStart, lte: weekEnd },
          },
        },
      });

      let goals = 0,
        assists = 0,
        matches = 0,
        photos = 0,
        ratingSum = 0,
        ratingCount = 0;

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
        avgRating: ratingCount ? ratingSum / ratingCount : 0,
      };
    }

    // =====================================================
    // DESTAQUES DA TEMPORADA (CARROSSEL DA HOME)
    // Só aparece entre highlightStart e highlightEnd
    // =====================================================
    let seasonHighlightYear = null;
    let seasonHighlightAwards = [];

    if (showSeasonHighlight) {
      // Pega ano mais recente que tem prêmios
      const latestAward = await prisma.seasonAward.findFirst({
        orderBy: { year: "desc" },
      });

      if (latestAward) {
        seasonHighlightYear = latestAward.year;

        const wantedCategories = [
          "melhor_jogador",
          "artilheiro",
          "assistente",
          "melhor_goleiro",
          "melhor_zagueiro",
          "melhor_meia",
          "melhor_atacante",
        ];

        seasonHighlightAwards = await prisma.seasonAward.findMany({
          where: {
            year: seasonHighlightYear,
            category: { in: wantedCategories },
          },
          include: { player: true },
        });
      }
    }

    // =====================================================
    // RANKINGS RÁPIDOS
    // =====================================================
    const topScorers = await prisma.player.findMany({
      orderBy: { totalGoals: "desc" },
      take: 10,
    });

    const topAssists = await prisma.player.findMany({
      orderBy: { totalAssists: "desc" },
      take: 10,
    });

    const topRatings = await prisma.player.findMany({
      where: { totalRating: { gt: 0 } },
      orderBy: { totalRating: "desc" },
      take: 10,
    });

    const photoKings = await prisma.player.findMany({
      orderBy: { totalPhotos: "desc" },
      take: 10,
    });

    // =====================================================
    // ELENCO
    // =====================================================
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    // =====================================================
    // ÚLTIMAS PELADAS
    // =====================================================
    const recentMatches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      take: 10,
    });

    // =====================================================
    // RENDER
    // =====================================================
    res.render("index", {
      title: "Home",
      activePage: "home",

      monthlyCraque,
      monthlyStats,
      weeklyAward,
      weeklyStats,

      seasonHighlightAwards,
      seasonHighlightYear,

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
// ==============================
router.get("/matches/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(404).render("404");

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: true },
          orderBy: { player: { name: "asc" } },
        },
      },
    });

    if (!match) return res.status(404).render("404");

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

// ==============================
// HALL DA FAMA – LIBERAÇÃO PROGRAMADA
// ==============================
router.get("/hall-da-fama", async (req, res) => {
  try {
    const now = new Date();

    // ✅ Liberação programada para 2025:
    // sábado 29/11 às 15h (horário de Brasília)
    const releaseDate = new Date("2025-11-29T15:00:00-03:00");
    const beforeRelease = now < releaseDate;

    let awards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    // ✅ Se ainda não chegou a data → esconder 2025
    if (beforeRelease) {
      awards = awards.filter((a) => a.year !== 2025);
    }

    if (!awards.length) {
      return res.render("hall_da_fama", {
        title: "Hall da Fama",
        activePage: "hall",
        awardsByYear: {},
        years: [],
        beforeRelease,
        releaseLabel: "29/11/2025 às 15h",
      });
    }

    const awardsByYear = awards.reduce((acc, a) => {
      if (!acc[a.year]) acc[a.year] = [];
      acc[a.year].push(a);
      return acc;
    }, {});

    const years = Object.keys(awardsByYear)
      .map(Number)
      .sort((a, b) => b - a);

    res.render("hall_da_fama", {
      title: "Hall da Fama",
      activePage: "hall",
      awardsByYear,
      years,
      beforeRelease,
      releaseLabel: "29/11/2025 às 15h",
    });
  } catch (err) {
    console.error("Erro ao carregar Hall da Fama:", err);
    res.status(500).send("Erro ao carregar Hall da Fama.");
  }
});

module.exports = router;
