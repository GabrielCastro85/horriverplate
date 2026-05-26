// routes/index.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { getAchievementsStats } = require("../utils/achievements");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");
const { getCache, setCache } = require("../utils/page_cache");
const { formatDateBR } = require("../utils/finance");
const CACHE_TTL_MS = 60 * 1000;
const SAO_PAULO_WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};


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

function getMonthRangeSaoPaulo(year, month) {
  // Sao Paulo is UTC-3; use UTC boundaries to avoid TZ drift in DB comparisons.
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 3, 0, 0, 0));
  return { start, end };
}

function getSaoPauloMonthYear(date = new Date()) {
  const parts = getSaoPauloDateParts(date);
  return { year: parts.year, month: parts.month };
}

function getSaoPauloDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value;
  const weekday = String(pick("weekday") || "sun").toLowerCase();
  return {
    year: Number(pick("year")),
    month: Number(pick("month")),
    day: Number(pick("day")),
    hour: Number(pick("hour") || 0) % 24,
    minute: Number(pick("minute") || 0),
    second: Number(pick("second") || 0),
    weekday: SAO_PAULO_WEEKDAY_INDEX[weekday] ?? 0,
  };
}

// ==============================
// HOME /
// ==============================
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const cached = getCache("home", CACHE_TTL_MS);
    if (cached) {
      return res.render("index", cached);
    }

    // Janela em que o carrossel da temporada aparece na home
    // (29/11/2024 –s 15h at– 31/12/2024 23:59:59 - hor–rio local do servidor)
    const highlightStart = new Date(2024, 10, 29, 15, 0, 0); // 29/11 (mês 10)
    const highlightEnd = new Date(2024, 11, 31, 23, 59, 59, 999); // 31/12
    const showSeasonHighlight =
      now.getTime() >= highlightStart.getTime() &&
      now.getTime() <= highlightEnd.getTime();

    // =====================================================
    // CRAQUE DO M–S
    // =====================================================
    const currentSaoPaulo = getSaoPauloMonthYear(now);
    const monthlyCraque = await prisma.monthlyAward.findFirst({
      where: {
        craqueId: { not: null },
        OR: [
          { year: { lt: currentSaoPaulo.year } },
          {
            year: currentSaoPaulo.year,
            month: { lte: currentSaoPaulo.month },
          },
        ],
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { craque: true },
    });

    let monthlyStats = null;
    let monthlyStatsMonth = null;
    let monthlyStatsYear = null;
    if (monthlyCraque?.craqueId) {
      const { month, year } = monthlyCraque;
      const { start: monthStart, end: monthEnd } = getMonthRangeSaoPaulo(year, month);

      let stats = await prisma.playerStat.findMany({
        where: {
          playerId: monthlyCraque.craqueId,
          match: {
            playedAt: { gte: monthStart, lt: monthEnd },
          },
        },
      });

      if (!stats.length) {
        const allStats = await prisma.playerStat.findMany({
          where: { playerId: monthlyCraque.craqueId },
          include: { match: true },
          orderBy: { match: { playedAt: "desc" } },
        });

        if (allStats.length) {
          const ref = new Date(allStats[0].match.playedAt);
          monthlyStatsMonth = ref.getMonth() + 1;
          monthlyStatsYear = ref.getFullYear();
          const range = getMonthRangeSaoPaulo(monthlyStatsYear, monthlyStatsMonth);
          stats = allStats.filter(
            (s) =>
              new Date(s.match.playedAt) >= range.start &&
              new Date(s.match.playedAt) < range.end
          );
        }
      }

      let goals = 0,
        assists = 0,
        matches = 0,
        photos = 0,
        ratingSum = 0,
        ratingCount = 0;

      stats.forEach((s) => {
        if (!s.present) return;

        goals += s.goals || 0;
        assists += s.assists || 0;
        matches++;
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
      if (!monthlyStatsMonth || !monthlyStatsYear) {
        monthlyStatsMonth = month;
        monthlyStatsYear = year;
      }
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
      const matchId =
        weeklyAward.winningMatchId || weeklyAward.winningMatch?.id || null;
      let computedWeeklyRating = null;

      if (matchId) {
        try {
          const result = await computeMatchRatingsAndAwards(matchId);
          if (!result.error && result.scores && typeof result.scores.get === "function") {
            const playerScore = result.scores.get(weeklyAward.bestPlayerId);
            if (
              playerScore &&
              playerScore.finalRating != null &&
              !Number.isNaN(Number(playerScore.finalRating))
            ) {
              computedWeeklyRating = Number(playerScore.finalRating);
            }
          }
        } catch (calcErr) {
          console.warn("Falha ao calcular nota final do craque da semana:", calcErr);
        }
      }

      let stats = [];
      if (matchId) {
        stats = await prisma.playerStat.findMany({
          where: {
            playerId: weeklyAward.bestPlayerId,
            matchId,
          },
        });
      } else {
        const weekStart = startOfDay(weeklyAward.weekStart);
        const weekEnd = endOfDay(
          new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
        );
        stats = await prisma.playerStat.findMany({
          where: {
            playerId: weeklyAward.bestPlayerId,
            match: {
              playedAt: { gte: weekStart, lte: weekEnd },
            },
          },
        });
      }

      let goals = 0,
        assists = 0,
        matches = 0,
        photos = 0,
        ratingSum = 0,
        ratingCount = 0;

      stats.forEach((s) => {
        if (!s.present) return;

        goals += s.goals || 0;
        assists += s.assists || 0;
        matches++;
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
        avgRating:
          computedWeeklyRating != null
            ? computedWeeklyRating
            : ratingCount
              ? ratingSum / ratingCount
              : 0,
      };
    }

    // =====================================================
    // DESTAQUES DA TEMPORADA (CARROSSEL DA HOME)
    // S– aparece entre highlightStart e highlightEnd
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
    // RANKINGS R–PIDOS
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

    const recentMatches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      take: 10,
    });

    // =====================================================
    // FEED DE ATIVIDADES
    // =====================================================
    const recentHatTricks = await prisma.playerStat.findMany({
      where: { goals: { gte: 3 }, present: true },
      include: {
        player: true,
        match: { select: { playedAt: true, id: true } },
      },
      orderBy: { match: { playedAt: "desc" } },
      take: 6,
    });

    const FEED_MONTH_NAMES = [
      "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
      "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
    ];

    const _activityItems = [];

    recentMatches.slice(0, 6).forEach((m) => {
      const winner = m.winnerTeam || (m.winnerColor ? `Time ${m.winnerColor}` : null);
      _activityItems.push({
        type: "match",
        label: m.description || "Pelada realizada",
        sub: winner ? `Vencedor: ${winner}` : "Sem vencedor definido",
        timestamp: m.playedAt,
        matchId: m.id,
        player: null,
      });
    });

    if (weeklyAward?.bestPlayer) {
      _activityItems.push({
        type: "weekly_award",
        label: `${weeklyAward.bestPlayer.nickname || weeklyAward.bestPlayer.name} é o Craque da Semana`,
        sub: weeklyAward.bestPlayer.position || "Destaque da pelada",
        timestamp: weeklyAward.winningMatch?.playedAt || weeklyAward.weekStart,
        matchId: weeklyAward.winningMatchId || null,
        player: weeklyAward.bestPlayer,
      });
    }

    if (monthlyCraque?.craque) {
      const mName = FEED_MONTH_NAMES[(monthlyCraque.month || 1) - 1] || "";
      _activityItems.push({
        type: "monthly_award",
        label: `${monthlyCraque.craque.nickname || monthlyCraque.craque.name} é o Craque de ${mName}`,
        sub: monthlyCraque.craque.position || "Melhor do mês",
        timestamp: new Date(`${monthlyCraque.year}-${String(monthlyCraque.month).padStart(2, "0")}-15`),
        matchId: null,
        player: monthlyCraque.craque,
      });
    }

    recentHatTricks.forEach((s) => {
      const g = s.goals || 0;
      const label = g >= 5 ? "manita" : g >= 4 ? "póker" : "hat-trick";
      _activityItems.push({
        type: "hat_trick",
        label: `${s.player.nickname || s.player.name} fez ${label}!`,
        sub: `${g} gols em uma pelada`,
        timestamp: s.match?.playedAt,
        matchId: s.match?.id || null,
        player: s.player,
      });
    });

    _activityItems.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const activityFeed = _activityItems.slice(0, 12);

    // =====================================================
    // RENDER
    // =====================================================
    const payload = {
      title: "Home",
      activePage: "home",

      monthlyCraque,
      monthlyStats,
      monthlyStatsMonth,
      monthlyStatsYear,
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
      activityFeed,
    };

    setCache("home", payload);
    res.render("index", payload);
  } catch (err) {
    console.error("Erro ao carregar home:", err);
    res.status(500).send("Erro ao carregar a página inicial.");
  }
});


// ==============================
// TIERLIST (publico)
// ==============================
router.get("/tierlist", async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      where: {
        OR: [{ hallReason: null }, { hallReason: { not: "Aposentado" } }],
      },
      orderBy: { name: "asc" },
    });

    res.render("tierlist", {
      title: "Tierlist",
      activePage: "tierlist",
      players,
    });
  } catch (err) {
    console.error("Erro ao carregar Tierlist:", err);
    res.status(500).send("Erro ao carregar Tierlist.");
  }
});

// ==============================
// LISTA DE PELADAS COM FILTRO POR M–S/ANO
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
      "mar–o",
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
      { value: "all", label: "Todos os mêses" },
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
    res.locals.metaDescription = `Peladas do mês ${monthLabel} e ano ${yearLabel}.`;

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
// FOTOS / HISTORIA (time vencedor + craques)
// ==============================
router.get("/fotos", async (req, res) => {
  try {
    const buildStats = (stats) => {
      let goals = 0,
        assists = 0,
        matches = 0,
        photos = 0,
        ratingSum = 0,
        ratingCount = 0;

      stats.forEach((s) => {
        if (!s.present) return;

        goals += s.goals || 0;
        assists += s.assists || 0;
        matches++;
        if (s.appearedInPhoto) photos++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      });

      return {
        goals,
        assists,
        matches,
        photos,
        avgRating: ratingCount ? ratingSum / ratingCount : 0,
      };
    };

    const weeklyAwards = await prisma.weeklyAward.findMany({
      orderBy: { weekStart: "desc" },
      include: { bestPlayer: true, winningMatch: true },
    });

    // Batch fetch playerStats for weekly awards (evita N+1 queries)
    const pairsWithMatch = (weeklyAwards || [])
      .filter(a => a.bestPlayerId && (a.winningMatchId || a.winningMatch?.id))
      .map(a => ({ playerId: a.bestPlayerId, matchId: a.winningMatchId || a.winningMatch?.id }));

    const awardsWithoutMatch = (weeklyAwards || []).filter(
      a => a.bestPlayerId && !a.winningMatchId && !a.winningMatch?.id
    );

    const [statsForPairs, statsForDateRange] = await Promise.all([
      pairsWithMatch.length > 0
        ? prisma.playerStat.findMany({
            where: { OR: pairsWithMatch.map(p => ({ playerId: p.playerId, matchId: p.matchId })) },
          })
        : Promise.resolve([]),
      awardsWithoutMatch.length > 0
        ? prisma.playerStat.findMany({
            where: { playerId: { in: [...new Set(awardsWithoutMatch.map(a => a.bestPlayerId))] } },
            include: { match: { select: { playedAt: true } } },
          })
        : Promise.resolve([]),
    ]);

    const statsByPairKey = new Map();
    statsForPairs.forEach(s => {
      const key = `${s.playerId}:${s.matchId}`;
      if (!statsByPairKey.has(key)) statsByPairKey.set(key, []);
      statsByPairKey.get(key).push(s);
    });

    const statsByPlayer = new Map();
    statsForDateRange.forEach(s => {
      if (!statsByPlayer.has(s.playerId)) statsByPlayer.set(s.playerId, []);
      statsByPlayer.get(s.playerId).push(s);
    });

    const weeklyEntries = (weeklyAwards || []).map(award => {
      if (!award.bestPlayerId) return { award, stats: null };
      const matchId = award.winningMatchId || award.winningMatch?.id || null;
      if (matchId) {
        const stats = statsByPairKey.get(`${award.bestPlayerId}:${matchId}`) || [];
        return { award, stats: buildStats(stats) };
      }
      const weekStart = startOfDay(award.weekStart);
      const weekEnd = endOfDay(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000));
      const filtered = (statsByPlayer.get(award.bestPlayerId) || []).filter(s => {
        const playedAt = s.match?.playedAt;
        return playedAt && playedAt >= weekStart && playedAt <= weekEnd;
      });
      return { award, stats: buildStats(filtered) };
    });

    const monthlyAwards = await prisma.monthlyAward.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { craque: true },
    });

    // Batch fetch playerStats para monthly awards (evita N+1 queries)
    const monthlyPlayerIds = [...new Set((monthlyAwards || []).filter(a => a.craqueId).map(a => a.craqueId))];
    const allMonthlyStats = monthlyPlayerIds.length > 0
      ? await prisma.playerStat.findMany({
          where: { playerId: { in: monthlyPlayerIds } },
          include: { match: { select: { playedAt: true } } },
        })
      : [];

    const monthlyStatsByPlayer = new Map();
    allMonthlyStats.forEach(s => {
      if (!monthlyStatsByPlayer.has(s.playerId)) monthlyStatsByPlayer.set(s.playerId, []);
      monthlyStatsByPlayer.get(s.playerId).push(s);
    });

    const monthlyEntries = (monthlyAwards || []).map(award => {
      if (!award.craqueId) return { award, stats: null };
      const { start: monthStart, end: monthEnd } = getMonthRangeSaoPaulo(award.year, award.month);
      const filtered = (monthlyStatsByPlayer.get(award.craqueId) || []).filter(s => {
        const playedAt = s.match?.playedAt;
        return playedAt && playedAt >= monthStart && playedAt < monthEnd;
      });
      return { award, stats: buildStats(filtered) };
    });

    const monthlyByKey = new Map(
      monthlyEntries.map((entry) => [
        `${entry.award.year}-${String(entry.award.month).padStart(2, "0")}`,
        entry,
      ])
    );

    const insertedMonthly = new Set();
    const timeline = [];

    for (let i = 0; i < weeklyEntries.length; i++) {
      const current = weeklyEntries[i];
      timeline.push({ type: "weekly", entry: current });
      const currentKey = monthKey(current.award.weekStart);
      const next = weeklyEntries[i + 1];
      const nextKey = next ? monthKey(next.award.weekStart) : null;

      if (currentKey !== nextKey) {
        const monthlyEntry = monthlyByKey.get(currentKey);
        if (monthlyEntry) {
          timeline.push({ type: "monthly", entry: monthlyEntry });
          insertedMonthly.add(currentKey);
        }
      }
    }

    monthlyEntries.forEach((entry) => {
      const key = `${entry.award.year}-${String(entry.award.month).padStart(
        2,
        "0"
      )}`;
      if (!insertedMonthly.has(key)) {
        timeline.push({ type: "monthly", entry });
      }
    });

    res.render("fotos", {
      title: "Fotos",
      activePage: "fotos",
      timeline,
    });
  } catch (err) {
    console.error("Erro ao carregar fotos:", err);
    res.status(500).send("Erro ao carregar fotos.");
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

    // Campe–es da temporada mais recente (premiação oficial)
    const seasonAwards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    let latestSeasonYear = null;
    let latestSeasonAwards = [];
    let hallFeatured = null;
    let latestSeasonPlayerStats = {};
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

      // Stats da temporada em destaque (evita mostrar totais da carreira na UI).
      // Faixa anual no fuso de Sao Paulo (UTC-3) para manter consistencia com o resto do app.
      const seasonStart = new Date(Date.UTC(latestSeasonYear, 0, 1, 3, 0, 0, 0));
      const seasonEnd = new Date(Date.UTC(latestSeasonYear + 1, 0, 1, 3, 0, 0, 0));
      const featuredPlayerIds = Array.from(
        new Set(
          Object.values(hallFeatured)
            .map((award) => award?.playerId)
            .filter((id) => Number.isFinite(id))
        )
      );

      if (featuredPlayerIds.length) {
        const seasonStats = await prisma.playerStat.findMany({
          where: {
            playerId: { in: featuredPlayerIds },
            match: {
              playedAt: {
                gte: seasonStart,
                lt: seasonEnd,
              },
            },
          },
          select: {
            playerId: true,
            present: true,
            goals: true,
            assists: true,
            appearedInPhoto: true,
            rating: true,
          },
        });

        latestSeasonPlayerStats = featuredPlayerIds.reduce((acc, playerId) => {
          acc[playerId] = {
            goals: 0,
            assists: 0,
            photos: 0,
            ratingAvg: 0,
          };
          return acc;
        }, {});

        const ratingBuckets = {};
        for (const s of seasonStats) {
        if (!s.present) continue;

        const current = latestSeasonPlayerStats[s.playerId];
        if (!current) continue;
        current.goals += s.goals || 0;
        current.assists += s.assists || 0;
          if (s.appearedInPhoto) current.photos += 1;

          if (typeof s.rating === "number") {
            if (!ratingBuckets[s.playerId]) {
              ratingBuckets[s.playerId] = { sum: 0, count: 0 };
            }
            ratingBuckets[s.playerId].sum += s.rating;
            ratingBuckets[s.playerId].count += 1;
          }
        }

        for (const [playerIdRaw, bucket] of Object.entries(ratingBuckets)) {
          const playerId = Number(playerIdRaw);
          if (!latestSeasonPlayerStats[playerId]) continue;
          latestSeasonPlayerStats[playerId].ratingAvg =
            bucket.count > 0 ? bucket.sum / bucket.count : 0;
        }
      }

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
        .filter(([year]) => Number(year) !== latestSeasonYear) // j– exibimos a mais recente em destaque
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
      latestSeasonPlayerStats,
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


