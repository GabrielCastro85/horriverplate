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

function monthKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
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
    // RANKINGS RÁPIDOS (agregados a partir de PlayerStat para evitar totals defasados)
    // =====================================================
    const playersRaw = await prisma.player.findMany({
      include: { stats: true },
    });

    const players = playersRaw
      .map((p) => {
        let goals = 0;
        let assists = 0;
        let matches = 0;
        let photos = 0;
        let ratingSum = 0;
        let ratingCount = 0;

        p.stats.forEach((s) => {
          goals += s.goals || 0;
          assists += s.assists || 0;
          if (s.present) matches++;
          if (s.appearedInPhoto) photos++;
          if (s.rating != null) {
            ratingSum += s.rating;
            ratingCount++;
          }
        });

        const rating = ratingCount ? ratingSum / ratingCount : 0;

        return {
          ...p,
          totalGoals: goals,
          totalAssists: assists,
          totalMatches: matches,
          totalPhotos: photos,
          totalRating: rating,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const topScorers = [...players]
      .filter((p) => p.totalGoals > 0 || p.totalMatches > 0)
      .sort((a, b) => {
        if (b.totalGoals !== a.totalGoals) return b.totalGoals - a.totalGoals;
        if (b.totalAssists !== a.totalAssists) return b.totalAssists - a.totalAssists;
        return b.totalMatches - a.totalMatches;
      })
      .slice(0, 10);

    const topAssists = [...players]
      .filter((p) => p.totalAssists > 0 || p.totalMatches > 0)
      .sort((a, b) => {
        if (b.totalAssists !== a.totalAssists) return b.totalAssists - a.totalAssists;
        if (b.totalGoals !== a.totalGoals) return b.totalGoals - a.totalGoals;
        return b.totalMatches - a.totalMatches;
      })
      .slice(0, 10);

    const topRatings = [...players]
      .filter((p) => p.totalMatches > 0 && p.totalRating > 0)
      .sort((a, b) => {
        if (b.totalRating !== a.totalRating) return b.totalRating - a.totalRating;
        return b.totalMatches - a.totalMatches;
      })
      .slice(0, 10);

    const photoKings = [...players]
      .filter((p) => p.totalPhotos > 0)
      .sort((a, b) => b.totalPhotos - a.totalPhotos)
      .slice(0, 10);

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

// ==============================
// LISTA DE PELADAS COM FILTRO POR MÊS
// ==============================
router.get("/peladas", async (req, res) => {
  try {
    const matches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      include: {
        _count: { select: { stats: true } },
      },
    });

    if (!matches.length) {
      return res.render("peladas", {
        title: "Peladas",
        activePage: "peladas",
        monthOptions: [],
        selectedMonth: null,
        matches: [],
      });
    }

    const monthNames = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];

    // Opções de ano (com "all")
    const yearsSet = new Set();
    matches.forEach((m) => {
      const y = new Date(m.playedAt).getFullYear();
      yearsSet.add(y);
    });
    const yearOptions = ["all", ...Array.from(yearsSet).sort((a, b) => b - a)];

    const selectedYearRaw = req.query.year || yearOptions[1] || "all";
    const selectedYear = yearOptions.includes(selectedYearRaw)
      ? selectedYearRaw
      : "all";

    // Opções de mês dependem do ano selecionado (ou todos)
    const monthsSet = new Set();
    matches.forEach((m) => {
      const d = new Date(m.playedAt);
      const y = d.getFullYear();
      const mn = d.getMonth() + 1;
      if (selectedYear === "all" || y === Number(selectedYear)) {
        monthsSet.add(mn);
      }
    });

    const monthOptions = [
      { value: "all", label: "Todos os meses" },
      ...Array.from(monthsSet)
        .sort((a, b) => b - a)
        .map((mn) => ({
          value: String(mn),
          label: `${monthNames[mn - 1]}${selectedYear !== "all" ? "" : ""}`,
        })),
    ];

    const selectedMonthRaw = req.query.month || "all";
    const monthValues = monthOptions.map((m) => m.value);
    const selectedMonth = monthValues.includes(selectedMonthRaw)
      ? selectedMonthRaw
      : "all";

    const filteredMatches = matches.filter((m) => {
      const d = new Date(m.playedAt);
      const y = d.getFullYear();
      const mn = d.getMonth() + 1;

      if (selectedYear !== "all" && y !== Number(selectedYear)) return false;
      if (selectedMonth !== "all" && mn !== Number(selectedMonth)) return false;
      return true;
    });

    res.render("peladas", {
      title: "Peladas",
      activePage: "peladas",
      yearOptions,
      selectedYear,
      monthOptions,
      selectedMonth,
      matches: filteredMatches,
    });
  } catch (err) {
    console.error("Erro ao listar peladas:", err);
    res.status(500).send("Erro ao carregar peladas.");
  }
});

module.exports = router;
