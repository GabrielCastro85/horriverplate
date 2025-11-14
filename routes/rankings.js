// routes/rankings.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// Calcula o intervalo de datas com base em year/month
function getDateRange(year, month) {
  // "Todos os anos" => sem filtro de data
  if (year === "all") {
    return { from: null, to: null };
  }

  const y = parseInt(year, 10);
  const m = parseInt(month, 10);

  if (Number.isNaN(y)) {
    return { from: null, to: null };
  }

  // Se tiver mês válido, filtra aquele mês
  if (!Number.isNaN(m) && m > 0 && m <= 12) {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);
    return { from, to };
  }

  // Senão, filtra o ano inteiro
  const from = new Date(y, 0, 1);
  const to = new Date(y + 1, 0, 1);
  return { from, to };
}

router.get("/", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    let { year, month, position } = req.query;

    // ✅ Defaults – ano atual como padrão se nada for enviado
    if (!year) year = String(currentYear); // ex: "2025"
    if (!month) month = "0"; // 0 = todos os meses
    const selPosition = position && position !== "all" ? position : "all";

    const { from, to } = getDateRange(year, month);

    // Filtro de posição nos jogadores
    const playerWhere =
      selPosition !== "all"
        ? { position: selPosition }
        : {};

    // Filtro de data via Match.playedAt
    const statsWhere = {};
    if (from && to) {
      statsWhere.match = {
        playedAt: {
          gte: from,
          lt: to,
        },
      };
    }

    // Puxa jogadores + stats filtradas
    const players = await prisma.player.findMany({
      where: playerWhere,
      include: {
        stats: {
          where: statsWhere,
          include: {
            match: true,
          },
        },
      },
    });

    // Monta dados agregados por jogador
    const entries = players.map((p) => {
      let goals = 0;
      let assists = 0;
      let matches = 0;
      let photos = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      for (const s of p.stats) {
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.present) matches++;
        if (s.appearedInPhoto) photos++;
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
        photos,
        rating,
      };
    });

    // ======= GOLS =======
    const goalsRanking = [...entries]
      .filter((e) => e.goals > 0 || e.assists > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;
        return b.matches - a.matches;
      });

    // ======= ASSISTÊNCIAS =======
    const assistsRanking = [...entries]
      .filter((e) => e.assists > 0 || e.goals > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.assists !== a.assists) return b.assists - a.assists;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.matches - a.matches;
      });

    // ======= GOLS + ASSISTÊNCIAS =======
    const gaRanking = [...entries]
      .map((e) => ({
        ...e,
        totalGA: (e.goals || 0) + (e.assists || 0),
      }))
      .filter((e) => e.totalGA > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.totalGA !== a.totalGA) return b.totalGA - a.totalGA;
        return b.matches - a.matches;
      });

    // ======= NOTAS =======
    const ratingsRanking = [...entries]
      .filter((e) => e.matches > 0 && e.rating > 0)
      .sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.matches - a.matches;
      });

    // ======= PRESENÇAS =======
    const matchesRanking = [...entries]
      .filter((e) => e.matches > 0)
      .sort((a, b) => {
        if (b.matches !== a.matches) return b.matches - a.matches;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.assists - a.assists;
      });

    // ======= FOTOS =======
    const photosRanking = [...entries]
      .filter((e) => e.photos > 0)
      .sort((a, b) => b.photos - a.photos);

    // ======= CRAQUES DA SEMANA (contagem) =======
    let weeklyWhere = {};
    if (from && to) {
      weeklyWhere = {
        weekStart: {
          gte: from,
          lt: to,
        },
      };
    }

    const weeklyRaw = await prisma.weeklyAward.findMany({
      where: weeklyWhere,
      include: { bestPlayer: true },
    });

    const weeklyMap = new Map();
    for (const w of weeklyRaw) {
      if (!w.bestPlayer) continue;
      const id = w.bestPlayer.id;
      if (!weeklyMap.has(id)) {
        weeklyMap.set(id, {
          player: w.bestPlayer,
          count: 0,
        });
      }
      weeklyMap.get(id).count++;
    }

    const weeklyAwards = Array.from(weeklyMap.values()).sort(
      (a, b) => b.count - a.count
    );

    // ======= CRAQUES DO MÊS (contagem) =======
    let monthlyWhere = {};
    const yearNum = parseInt(year, 10);
    const monthNum = parseInt(month, 10);

    if (year !== "all" && !Number.isNaN(yearNum)) {
      monthlyWhere.year = yearNum;
      if (!Number.isNaN(monthNum) && monthNum > 0) {
        monthlyWhere.month = monthNum;
      }
    }

    const monthlyRaw = await prisma.monthlyAward.findMany({
      where: monthlyWhere,
      include: { craque: true },
    });

    const monthlyMap = new Map();
    for (const m of monthlyRaw) {
      if (!m.craque) continue;
      const id = m.craque.id;
      if (!monthlyMap.has(id)) {
        monthlyMap.set(id, {
          player: m.craque,
          count: 0,
        });
      }
      monthlyMap.get(id).count++;
    }

    const monthlyAwards = Array.from(monthlyMap.values()).sort(
      (a, b) => b.count - a.count
    );

    const rankings = {
      goals: goalsRanking,
      assists: assistsRanking,
      ga: gaRanking,
      ratings: ratingsRanking,
      matches: matchesRanking,
      photos: photosRanking,
      weeklyAwards,
      monthlyAwards,
    };

    return res.render("rankings", {
      title: "Rankings",
      rankings,
      year,                // pode ser "all" ou número em string
      month: Number(month),
      selPosition,
      currentYear,
    });
  } catch (err) {
    console.error("Erro ao carregar rankings:", err);
    return res.status(500).send("Erro ao carregar rankings.");
  }
});

module.exports = router;
