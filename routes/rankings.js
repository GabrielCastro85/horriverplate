// routes/rankings.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");

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

  // Se tiver m├¬s v├ílido, filtra aquele m├¬s
  if (!Number.isNaN(m) && m > 0 && m <= 12) {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);
    return { from, to };
  }

  // Sen├úo, filtra o ano inteiro
  const from = new Date(y, 0, 1);
  const to = new Date(y + 1, 0, 1);
  return { from, to };
}

router.get("/", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    let { year, month, position } = req.query;

    // Defaults ÔÇô ano atual como padr├úo se nada for enviado
    if (!year) year = String(currentYear);
    if (!month) month = "0"; // 0 = todos os meses
    const selPosition = position && position !== "all" ? position : "all";

    const { from, to } = getDateRange(year, month);

    // Filtro de posi├º├úo nos jogadores
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

    // ======= FORMA RECENTE (últimas 10 peladas gerais) =======
    // Pega as 10 peladas mais recentes (dentro do filtro de data) e agrega nelas.
    const allStats = players.flatMap((p) =>
      (p.stats || []).map((s) => ({
        ...s,
        player: p,
      }))
    );

    const matchesById = new Map();
    for (const s of allStats) {
      if (s.match && s.match.id && s.match.playedAt) {
        matchesById.set(s.match.id, new Date(s.match.playedAt));
      }
    }
    const latestMatchIds = Array.from(matchesById.entries())
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, 10)
      .map(([id]) => id);
    const latestMatchSet = new Set(latestMatchIds);

    const recentAggregates = players
      .map((p) => {
        const recentStats = (p.stats || []).filter(
          (s) => s.match && latestMatchSet.has(s.match.id)
        );

        let goals = 0;
        let assists = 0;
        let matches = 0;
        let ratingSum = 0;
        let ratingCount = 0;

        for (const s of recentStats) {
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
      })
      .filter((e) => e.matches > 0 || e.goals > 0 || e.assists > 0);

    const maxGoalsRecent = recentAggregates.reduce(
      (max, e) => (e.goals > max ? e.goals : max),
      0
    );
    const maxAssistsRecent = recentAggregates.reduce(
      (max, e) => (e.assists > max ? e.assists : max),
      0
    );

    // pesos: rating 5, gols 3, assist 2 (total 10)
    const recentRanking = recentAggregates
      .map((e) => {
        const goalsNorm =
          maxGoalsRecent > 0 ? (e.goals / maxGoalsRecent) * 10 : 0;
        const assistsNorm =
          maxAssistsRecent > 0 ? (e.assists / maxAssistsRecent) * 10 : 0;
        const ratingNorm = e.rating || 0;

        const recentScore =
          (ratingNorm * 5 + goalsNorm * 3 + assistsNorm * 2) / 10;

        return {
          ...e,
          recentScore,
          goalsNorm,
          assistsNorm,
          ratingNorm,
        };
      })
      .sort((a, b) => {
        if (b.recentScore !== a.recentScore) {
          return b.recentScore - a.recentScore;
        }
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.assists - a.assists;
      });

    // ======= M├ëDIA PONDERADA (0ÔÇô10) =======
    // Normaliza gols e assist├¬ncias para 0ÔÇô10 com base no m├íximo do per├¡odo
    const maxGoals = entries.reduce(
      (max, e) => (e.goals > max ? e.goals : max),
      0
    );
    const maxAssists = entries.reduce(
      (max, e) => (e.assists > max ? e.assists : max),
      0
    );

    // Pesos (G=4 / A=2 / N=4)
    const weights = {
      goals: 4,
      assists: 2,
      rating: 4,
    };
    const weightsSum = weights.goals + weights.assists + weights.rating;

    const weightedRanking = entries
      .map((e) => {
        const golsNorm =
          maxGoals > 0 ? (e.goals / maxGoals) * 10 : 0;
        const assistsNorm =
          maxAssists > 0 ? (e.assists / maxAssists) * 10 : 0;
        const ratingNorm = e.rating || 0; // j├í est├í em 0ÔÇô10

        const weightedScore =
          weightsSum > 0
            ? (golsNorm * weights.goals +
                assistsNorm * weights.assists +
                ratingNorm * weights.rating) /
              weightsSum
            : 0;

        return {
          ...e,
          weightedScore,
          golsNorm,
          assistsNorm,
          ratingNorm,
        };
      })
      // pelo menos alguma participa├º├úo
      .filter((e) => e.matches > 0 || e.goals > 0 || e.assists > 0)
      .sort((a, b) => {
        if (b.weightedScore !== a.weightedScore) {
          return b.weightedScore - a.weightedScore;
        }
        // desempates: nota > gols > assist├¬ncias
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.assists - a.assists;
      });

    // ======= GOLS =======
    const goalsRanking = [...entries]
      .filter((e) => e.goals > 0 || e.assists > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;
        return b.matches - a.matches;
      });

    // ======= ASSIST├èNCIAS =======
    const assistsRanking = [...entries]
      .filter((e) => e.assists > 0 || e.goals > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.assists !== a.assists) return b.assists - a.assists;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.matches - a.matches;
      });

    // ======= GOLS + ASSIST├èNCIAS =======
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

    // ======= OVERALL 0-100 (pesos por posição) =======
    const { computed: overallComputed } = computeOverallFromEntries(entries);
    const overallRanking = overallComputed
      .filter((e) => e.matches > 0 || e.goals > 0 || e.assists > 0)
      .map((e) => ({ ...e, overallScore: e.overall }))
      .sort((a, b) => {
        if (b.overall !== a.overall) return b.overall - a.overall;
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.assists - a.assists;
      });

    // ======= PRESEN├çAS =======
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

    // ======= CRAQUES DO M├èS (contagem) =======
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

    const last10Ranking = recentRanking.map((e) => ({
      ...e,
      last10Score: e.recentScore,
    }));

    const rankings = {
      goals: goalsRanking,
      assists: assistsRanking,
      ga: gaRanking,
      ratings: ratingsRanking,
      matches: matchesRanking,
      photos: photosRanking,
      overall: overallRanking,
      weighted: weightedRanking,
      recent: recentRanking,
      last10: last10Ranking,
      weeklyAwards,
      monthlyAwards,
    };

    return res.render("rankings", {
      title: "Rankings",
      rankings,
      year,                // pode ser "all" ou n├║mero em string
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
