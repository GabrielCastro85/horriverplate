const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// Monta o range de datas
function buildDateRange(scope, year, month) {
  if (scope === "all") return null;

  const y = year || new Date().getFullYear();

  if (scope === "year") {
    const start = new Date(y, 0, 1);
    const end = new Date(y + 1, 0, 1);
    return { start, end };
  }

  if (scope === "month" && month && month >= 1 && month <= 12) {
    const start = new Date(y, month - 1, 1);
    const end = new Date(y, month, 1);
    return { start, end };
  }

  return null;
}

router.get("/", async (req, res) => {
  const currentYear = new Date().getFullYear();
  const scope = req.query.scope || "all"; // all | year | month
  const year = parseInt(req.query.year || currentYear, 10);
  const month = parseInt(req.query.month || "0", 10) || 0;

  const range = buildDateRange(scope, year, month);

  try {
    const playersMap = new Map();

    // ==============================
    // 1) Dados base para rankings de stats
    // ==============================
    if (!range) {
      // Sem filtro de datas: usa totais da tabela Player
      const players = await prisma.player.findMany({
        orderBy: { name: "asc" },
      });

      for (const p of players) {
        playersMap.set(p.id, {
          player: p,
          goals: p.totalGoals || 0,
          assists: p.totalAssists || 0,
          matches: p.totalMatches || 0,
          photos: p.totalPhotos || 0,
          rating: p.totalRating || 0,
        });
      }
    } else {
      // Com filtro de datas: agrega de PlayerStat + Match
      const stats = await prisma.playerStat.findMany({
        where: {
          match: {
            playedAt: {
              gte: range.start,
              lt: range.end,
            },
          },
        },
        include: {
          player: true,
          match: true,
        },
      });

      for (const s of stats) {
        if (!playersMap.has(s.playerId)) {
          playersMap.set(s.playerId, {
            player: s.player,
            goals: 0,
            assists: 0,
            matches: 0,
            photos: 0,
            ratingSum: 0,
            ratingCount: 0,
            rating: 0,
          });
        }

        const agg = playersMap.get(s.playerId);
        agg.goals += s.goals || 0;
        agg.assists += s.assists || 0;
        if (s.present) agg.matches++;
        if (s.appearedInPhoto) agg.photos++;
        if (s.rating != null) {
          agg.ratingSum += s.rating;
          agg.ratingCount++;
        }
      }

      // Calcula média de notas
      for (const agg of playersMap.values()) {
        if (agg.ratingCount > 0) {
          agg.rating = agg.ratingSum / agg.ratingCount;
        } else {
          agg.rating = 0;
        }
      }
    }

    const list = Array.from(playersMap.values());

    // ==============================
    // 2) Função genérica de ordenação (SEM limite de top 10)
    // ==============================
    function sortBy(field, calcFn) {
      return [...list]
        .filter((item) => {
          if (calcFn) return calcFn(item) > 0;
          if (field === "rating") return item.rating > 0;
          return item[field] > 0;
        })
        .sort((a, b) => {
          const va = calcFn ? calcFn(a) : a[field];
          const vb = calcFn ? calcFn(b) : b[field];

          if (vb !== va) return vb - va;
          return a.player.name.localeCompare(b.player.name);
        });
      // ❌ removido .slice(0, 10) para listar todos
    }

    // ==============================
    // 3) Rankings de stats
    // ==============================
    const byGoals = sortBy("goals");
    const byAssists = sortBy("assists");
    const byGA = sortBy(null, (i) => (i.goals || 0) + (i.assists || 0));
    const byRating = sortBy("rating");
    const byMatches = sortBy("matches");
    const byPhotos = sortBy("photos");

    const byPosition = {
      Goleiro: list.filter((i) => i.player.position === "Goleiro"),
      Zagueiro: list.filter((i) => i.player.position === "Zagueiro"),
      Meia: list.filter((i) => i.player.position === "Meia"),
      Atacante: list.filter((i) => i.player.position === "Atacante"),
    };

    // ==============================
    // 4) Rankings de craques da semana / mês
    // ==============================

    // Craque da semana (bestPlayer em WeeklyAward)
    const weeklyAwardsRaw = await prisma.weeklyAward.findMany({
      where: { bestPlayerId: { not: null } },
      include: { bestPlayer: true },
    });

    const weeklyMap = new Map();
    for (const award of weeklyAwardsRaw) {
      if (!award.bestPlayer) continue;
      const id = award.bestPlayer.id;
      if (!weeklyMap.has(id)) {
        weeklyMap.set(id, {
          player: award.bestPlayer,
          count: 0,
        });
      }
      weeklyMap.get(id).count++;
    }

    const weeklyAwardsRanking = Array.from(weeklyMap.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.player.name.localeCompare(b.player.name);
    });

    // Craque do mês (craque em MonthlyAward)
    const monthlyAwardsRaw = await prisma.monthlyAward.findMany({
      where: { craqueId: { not: null } },
      include: { craque: true },
    });

    const monthlyMap = new Map();
    for (const award of monthlyAwardsRaw) {
      if (!award.craque) continue;
      const id = award.craque.id;
      if (!monthlyMap.has(id)) {
        monthlyMap.set(id, {
          player: award.craque,
          count: 0,
        });
      }
      monthlyMap.get(id).count++;
    }

    const monthlyAwardsRanking = Array.from(monthlyMap.values()).sort(
      (a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.player.name.localeCompare(b.player.name);
      }
    );

    // ==============================
    // 5) Render
    // ==============================
    res.render("rankings", {
      title: "Rankings",
      scope,
      year,
      month,
      currentYear,
      rankings: {
        goals: byGoals,
        assists: byAssists,
        ga: byGA,
        ratings: byRating,
        matches: byMatches,
        photos: byPhotos,
        byPosition,
        weeklyAwards: weeklyAwardsRanking,
        monthlyAwards: monthlyAwardsRanking,
      },
    });
  } catch (err) {
    console.error("Erro em /rankings:", err);
    res.status(500).send("Erro ao carregar rankings");
  }
});

module.exports = router;
