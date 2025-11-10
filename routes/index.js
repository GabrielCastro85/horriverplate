// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// Home pública
router.get("/", async (req, res) => {
  try {
    // ============================
    // 1) BUSCAS EM PARALELO
    // ============================
    const [
      topScorers,
      topAssists,
      topRatings,
      photoKings,
      weeklyAward,
      monthlyCraque,
      recentMatches,
      players,
    ] = await Promise.all([
      // Artilheiros
      prisma.player.findMany({
        orderBy: [{ totalGoals: "desc" }, { name: "asc" }],
        take: 10,
      }),

      // Assistências
      prisma.player.findMany({
        orderBy: [{ totalAssists: "desc" }, { name: "asc" }],
        take: 10,
      }),

      // Notas (somente quem já jogou alguma)
      prisma.player.findMany({
        where: { totalMatches: { gt: 0 } },
        orderBy: [{ totalRating: "desc" }, { name: "asc" }],
        take: 10,
      }),

      // Reis da foto
      prisma.player.findMany({
        orderBy: [{ totalPhotos: "desc" }, { name: "asc" }],
        take: 10,
      }),

      // Destaque da semana mais recente
      prisma.weeklyAward.findFirst({
        orderBy: { weekStart: "desc" },
        include: {
          bestPlayer: true,
          winningMatch: true,
        },
      }),

      // Craque do mês mais recente
      prisma.monthlyAward.findFirst({
        orderBy: [{ year: "desc" }, { month: "desc" }],
        include: {
          craque: true,
        },
      }),

      // Últimas peladas
      prisma.match.findMany({
        orderBy: { playedAt: "desc" },
        take: 5,
      }),

      // Elenco (vamos usar pra prévia na home)
      prisma.player.findMany({
        orderBy: { name: "asc" },
      }),
    ]);

    // ============================
    // 2) STATS DO CRAQUE DO MÊS
    // ============================
    let monthlyStats = null;

    if (monthlyCraque && monthlyCraque.craqueId) {
      // início e fim do mês daquele prêmio
      const monthStart = new Date(monthlyCraque.year, monthlyCraque.month - 1, 1);
      const monthEnd = new Date(monthlyCraque.year, monthlyCraque.month, 1); // exclusivo

      const agg = await prisma.playerStat.aggregate({
        where: {
          playerId: monthlyCraque.craqueId,
          match: {
            playedAt: {
              gte: monthStart,
              lt: monthEnd,
            },
          },
        },
        _sum: {
          goals: true,
          assists: true,
        },
        _avg: {
          rating: true,
        },
        _count: {
          id: true,
        },
      });

      monthlyStats = {
        goals: agg._sum.goals || 0,
        assists: agg._sum.assists || 0,
        matches: agg._count.id || 0,
        photos: 0, // se um dia tiver controle por mês, dá pra trocar aqui
        avgRating: agg._avg.rating || 0,
      };
    }

    // ============================
    // 3) STATS DO CRAQUE DA SEMANA
    // ============================
    let weeklyStats = null;

    if (
      weeklyAward &&
      weeklyAward.bestPlayerId &&
      weeklyAward.winningMatchId
    ) {
      // PlayerStat daquela pelada específica
      const stat = await prisma.playerStat.findUnique({
        where: {
          playerId_matchId: {
            playerId: weeklyAward.bestPlayerId,
            matchId: weeklyAward.winningMatchId,
          },
        },
      });

      if (stat) {
        weeklyStats = {
          goals: stat.goals || 0,
          assists: stat.assists || 0,
          // não usamos matches na tela, mas deixo 1 por semântica
          matches: 1,
          avgRating: stat.rating || 0,
        };
      }
    }

    // ============================
    // 4) RENDERIZA HOME
    // ============================
    res.render("index", {
      title: "Home",
      activePage: "home",

      topScorers,
      topAssists,
      topRatings,
      photoKings,

      weeklyAward,
      weeklyStats,      // <== IMPORTANTE

      monthlyCraque,
      monthlyStats,     // <== IMPORTANTE

      recentMatches,
      players,
    });
  } catch (err) {
    console.error("Erro na rota /:", err);
    res.status(500).send("Erro ao carregar a página inicial");
  }
});

module.exports = router;
