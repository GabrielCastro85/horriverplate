// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// monta estatísticas de um jogador num intervalo de datas
async function buildPlayerStatsInRange(playerId, start, end) {
  const stats = await prisma.playerStat.findMany({
    where: {
      playerId,
      match: {
        playedAt: {
          gte: start,
          lt: end,
        },
      },
    },
    include: {
      match: true,
    },
  });

  if (!stats.length) {
    return {
      goals: 0,
      assists: 0,
      matches: 0,
      photos: 0,
      avgRating: 0,
    };
  }

  let goals = 0;
  let assists = 0;
  let matches = 0;
  let photos = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const s of stats) {
    goals += s.goals || 0;
    assists += s.assists || 0;
    if (s.present) matches += 1;
    if (s.appearedInPhoto) photos += 1;
    if (s.rating != null) {
      ratingSum += s.rating;
      ratingCount += 1;
    }
  }

  const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

  return {
    goals,
    assists,
    matches,
    photos,
    avgRating,
  };
}

// HOME
router.get("/", async (req, res) => {
  try {
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
      // Artilheiros (totais)
      prisma.player.findMany({
        orderBy: [{ totalGoals: "desc" }, { name: "asc" }],
        take: 10,
      }),
      // Assistências (totais)
      prisma.player.findMany({
        orderBy: [{ totalAssists: "desc" }, { name: "asc" }],
        take: 10,
      }),
      // Notas (totais, só quem jogou)
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
      // Craque da semana mais recente
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
      // Elenco (pra preview)
      prisma.player.findMany({
        orderBy: { name: "asc" },
      }),
    ]);

    // ---------- stats do CRAQUE DO MÊS (somente no mês) ----------
    let monthlyStats = null;
    if (monthlyCraque && monthlyCraque.craqueId) {
      const start = new Date(monthlyCraque.year, monthlyCraque.month - 1, 1);
      const end = new Date(monthlyCraque.year, monthlyCraque.month, 1);
      monthlyStats = await buildPlayerStatsInRange(
        monthlyCraque.craqueId,
        start,
        end
      );
    }

    // ---------- stats do CRAQUE DA SEMANA (somente na semana) ----------
    let weeklyStats = null;
    if (weeklyAward && weeklyAward.bestPlayerId && weeklyAward.weekStart) {
      const start = new Date(weeklyAward.weekStart);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // +7 dias = semana

      weeklyStats = await buildPlayerStatsInRange(
        weeklyAward.bestPlayerId,
        start,
        end
      );
    }

    res.render("index", {
      activePage: "home",
      topScorers,
      topAssists,
      topRatings,
      photoKings,
      weeklyAward,
      monthlyCraque,
      monthlyStats,
      weeklyStats,
      recentMatches,
      players,
    });
  } catch (err) {
    console.error("Erro na rota /:", err);
    res.status(500).send("Erro ao carregar a página inicial");
  }
});

// ------------------------------------------------------
// ROTA PÚBLICA: stats da pelada /matches/:id
// ------------------------------------------------------
router.get("/matches/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    return res.status(404).render("404", { activePage: null });
  }

  try {
    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        // <-- aqui estava o erro: o nome correto é "stats"
        stats: {
          include: {
            player: true,
          },
        },
      },
    });

    if (!match) {
      return res.status(404).render("404", { activePage: null });
    }

    // Ordena os stats em ordem alfabética pelo nome do jogador
    const stats = [...match.stats].sort((a, b) => {
      const nameA = a.player?.name || "";
      const nameB = b.player?.name || "";
      return nameA.localeCompare(nameB, "pt-BR");
    });

    res.render("match_public", {
      activePage: null,
      match,
      stats,
    });
  } catch (err) {
    console.error("Erro em GET /matches/:id", err);
    res.status(500).send("Erro ao carregar estatísticas da pelada");
  }
});

module.exports = router;
