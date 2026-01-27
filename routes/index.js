// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { getAchievementsStats } = require("../utils/achievements");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key, value) {
  cache.set(key, { value, timestamp: Date.now() });
}


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

function getNextTuesdayAtHour(baseDate, hour = 20) {
  const base = new Date(baseDate);
  const day = base.getDay(); // 0=Sun, 1=Mon, 2=Tue
  let diff = (2 - day + 7) % 7;
  const target = new Date(base);
  if (diff === 0) {
    const sameDay = new Date(base);
    sameDay.setHours(hour, 0, 0, 0);
    if (base.getTime() < sameDay.getTime()) {
      return sameDay;
    }
    diff = 7;
  }
  target.setDate(base.getDate() + diff);
  target.setHours(hour, 0, 0, 0);
  return target;
}

async function ensureNextTuesdayMatch(baseDate) {
  const target = getNextTuesdayAtHour(baseDate, 20);
  const dayStart = startOfDay(target);
  const dayEnd = endOfDay(target);

  const existing = await prisma.match.findFirst({
    where: { playedAt: { gte: dayStart, lte: dayEnd } },
  });

  if (existing) return { match: existing, created: false };

  const created = await prisma.match.create({
    data: {
      playedAt: target,
      description: "Pelada da terca",
    },
  });

  return { match: created, created: true };
}

// ==============================
// HOME /
// ==============================
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const scheduleResult = await ensureNextTuesdayMatch(now);
    if (scheduleResult.created) {
      cache.delete("home");
    }

    const cached = getCache("home");
    if (cached) {
      return res.render("index", cached);
    }

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
    // ULTIMAS / PROXIMAS PELADAS
    // =====================================================
    const lastMatch = await prisma.match.findFirst({
      where: { playedAt: { lte: now } },
      orderBy: { playedAt: "desc" },
    });

    const nextMatch = await prisma.match.findFirst({
      where: { playedAt: { gt: now } },
      orderBy: { playedAt: "asc" },
    });

    const recentMatches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      take: 10,
    });

    // =====================================================
    // RENDER
    // =====================================================
    const payload = {
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
      lastMatch,
      nextMatch,
      recentMatches,
    };

    setCache("home", payload);
    res.render("index", payload);
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

    const weeklyPhoto = await prisma.weeklyAward.findFirst({
      where: { winningMatchId: id, teamPhotoUrl: { not: null } },
      orderBy: { weekStart: "desc" },
      select: { teamPhotoUrl: true },
    });


    let publicStats = match.stats || [];
    try {
      const result = await computeMatchRatingsAndAwards(id);
      if (!result.error && result.scores && typeof result.scores.forEach === 'function') {
        const finalMap = new Map();
        result.scores.forEach((score) => {
          finalMap.set(score.player.id, score.finalRating);
        });
        publicStats = publicStats.map((stat) => ({
          ...stat,
          rating: finalMap.has(stat.playerId)
            ? finalMap.get(stat.playerId)
            : stat.rating,
        }));
      }
    } catch (calcErr) {
      console.warn("Falha ao calcular nota final p£blica:", calcErr);
    }

    const baseUrl =
      process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
    const matchDateLabel = new Date(match.playedAt).toLocaleDateString("pt-BR");
    const matchDesc = match.description
      ? `Pelada em ${matchDateLabel}. ${match.description}`
      : `Pelada em ${matchDateLabel}.`;
    const shareImagePath = weeklyPhoto?.teamPhotoUrl || "/img/logo.jpg";
    const shareImageUrl = `${baseUrl}${req.app.locals.thumbUrl(
      shareImagePath,
      1200
    )}`;

    res.locals.metaDescription = matchDesc;
    res.locals.metaImage = shareImageUrl;
    res.locals.ogTitle = `Pelada ${matchDateLabel} | Horriver Plate`;

    res.render("match_public", {
      title: "Estat¡sticas da pelada",
      activePage: "home",
      match,
      stats: publicStats,
      tournament: null,
      tournamentStandings: [],
      tournamentTeams: [],
    });
  } catch (err) {
    console.error("Erro ao carregar pelada pública:", err);
    res.status(500).send("Erro ao carregar estatísticas da pelada.");
  }
});

// ==============================
// LISTA DE PELADAS COM FILTRO POR MÊS/ANO
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
        yearOptions: [],
        selectedMonth: null,
        selectedYear: null,
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
          label: monthNames[mn - 1],
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

    const monthLabel =
      selectedMonth !== "all"
        ? monthNames[Number(selectedMonth) - 1] || "todos"
        : "todos";
    const yearLabel = selectedYear !== "all" ? selectedYear : "todos";
    res.locals.metaDescription = `Peladas do mes ${monthLabel} e ano ${yearLabel}.`;

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

// ==============================
// HALL DA FAMA 2.0
// ==============================
router.get("/hall-da-fama", async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      where: { isHallOfFame: true },
      orderBy: [{ hallInductedAt: "desc" }, { name: "asc" }],
      include: {
        achievements: { include: { achievement: true } },
      },
    });

    // Campeões da temporada mais recente (premiação oficial)
    const seasonAwards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    let latestSeasonYear = null;
    let latestSeasonAwards = [];
    let hallFeatured = null;
    let previousSeasonYear = null;
    let previousSeasonAwards = [];
    let seasonHistory = [];
    if (seasonAwards.length) {
      latestSeasonYear = seasonAwards[0].year;
      latestSeasonAwards = seasonAwards.filter(
        (a) => a.year === latestSeasonYear
      );

      const byCategory = (cat) =>
        latestSeasonAwards.find((a) => a.category === cat) || null;

      // categorias seguem o enum SeasonAwardCategory (uppercase)
      hallFeatured = {
        best: byCategory("MELHOR_JOGADOR"),
        scorer: byCategory("ARTILHEIRO"),
        assist: byCategory("ASSISTENTE"),
        photos: byCategory("REI_DAS_FOTOS"),
        goalie: byCategory("MELHOR_GOLEIRO"),
        defender: byCategory("MELHOR_ZAGUEIRO"),
        midfielder: byCategory("MELHOR_MEIA"),
        forward: byCategory("MELHOR_ATACANTE"),
      };

      // pega o ano anterior (se existir) para histórico
      const otherYear = seasonAwards.find((a) => a.year < latestSeasonYear);
      if (otherYear) {
        previousSeasonYear = otherYear.year;
        previousSeasonAwards = seasonAwards.filter(
          (a) => a.year === previousSeasonYear
        );
      }

      // agrupa todos os anos para histórico completo
      const awardsByYear = seasonAwards.reduce((acc, award) => {
        const y = award.year;
        if (!acc[y]) acc[y] = [];
        acc[y].push(award);
        return acc;
      }, {});
      seasonHistory = Object.entries(awardsByYear)
        .filter(([year]) => Number(year) !== latestSeasonYear) // já exibimos a mais recente em destaque
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .map(([year, awards]) => ({
          year: Number(year),
          awards,
        }));
    }

    const retiredPlayers = await prisma.player.findMany({
      where: { hallReason: "Aposentado" },
      orderBy: [{ name: "asc" }],
    });

    res.render("hall_da_fama", {
      title: "Hall da Fama",
      activePage: "hall",
      players,
      latestSeasonYear,
      latestSeasonAwards,
      hallFeatured,
      previousSeasonYear,
      previousSeasonAwards,
      seasonHistory,
      retiredPlayers,
    });
  } catch (err) {
    console.error("Erro ao carregar Hall da Fama:", err);
    res.status(500).send("Erro ao carregar Hall da Fama.");
  }
});

// ==============================
// DEMO DE BADGES
// ==============================
router.get("/badges-demo", (req, res) => {
  res.render("awards_badges_demo", {
    title: "Badges Demo",
    activePage: "home",
  });
});

// ==============================
// HALL DE CONQUISTAS
// ==============================
router.get("/achievements", async (req, res) => {
  try {
    const stats = await getAchievementsStats();
    const grouped = stats.reduce((acc, item) => {
      const cat = item.achievement.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    }, {});
    res.render("achievements", {
      title: "Hall de Conquistas",
      activePage: "home",
      grouped,
    });
  } catch (err) {
    console.error("Erro ao carregar conquistas:", err);
    res.status(500).send("Erro ao carregar conquistas.");
  }
});

module.exports = router;

