// routes/rankings.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");
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

  // Se tiver m+–s v+–lido, filtra aquele m+–s
  if (!Number.isNaN(m) && m > 0 && m <= 12) {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 1);
    return { from, to };
  }

  // Sen+–o, filtra o ano inteiro
  const from = new Date(y, 0, 1);
  const to = new Date(y + 1, 0, 1);
  return { from, to };
}

router.get("/", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();

    let { year, month, position } = req.query;

    // Defaults ––– ano atual como padr+–o se nada for enviado
    if (!year) year = String(currentYear);
    if (!month) month = "0"; // 0 = todos os meses
    const selPosition = position && position !== "all" ? position : "all";

    const cacheKey = `rankings:${year}:${month}:${selPosition}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.render("rankings", cached);
    }

    const { from, to } = getDateRange(year, month);

    const playerWhere =
      selPosition !== "all"
        ? { position: selPosition }
        : {};

    const statsWhere = {};
    if (from && to) {
      statsWhere.match = {
        playedAt: {
          gte: from,
          lt: to,
        },
      };
    }

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

    const matchIds = new Set();
    players.forEach((p) => {
      (p.stats || []).forEach((s) => {
        if (s.match && s.match.id) matchIds.add(s.match.id);
      });
    });

    const finalRatingsByMatch = new Map();
    for (const matchId of matchIds) {
      try {
        const result = await computeMatchRatingsAndAwards(matchId);
        if (!result.error && result.scores && typeof result.scores.forEach === "function") {
          const map = new Map();
          result.scores.forEach((score) => {
            map.set(score.player.id, score.finalRating);
          });
          finalRatingsByMatch.set(matchId, map);
        }
      } catch (err) {
        console.warn("Falha ao calcular notas finais no ranking:", err);
      }
    }

    const getFinalRating = (stat) => {
      const matchId = stat.match && stat.match.id;
      if (!matchId) return stat.rating;
      const map = finalRatingsByMatch.get(matchId);
      if (map && map.has(stat.playerId)) return map.get(stat.playerId);
      return stat.rating;
    };

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
        const finalRating = getFinalRating(s);
        if (finalRating != null) {
          ratingSum += finalRating;
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
          const finalRating = getFinalRating(s);
          if (finalRating != null) {
            ratingSum += finalRating;
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

    // ======= M+–DIA PONDERADA (0–––10) =======
    // Normaliza gols e assist+–ncias para 0–––10 com base no m+–ximo do per+–odo
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
        const ratingNorm = e.rating || 0; // j+– est+– em 0–––10

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
      // pelo menos alguma participa+–+–o
      .filter((e) => e.matches > 0 || e.goals > 0 || e.assists > 0)
      .sort((a, b) => {
        if (b.weightedScore !== a.weightedScore) {
          return b.weightedScore - a.weightedScore;
        }
        // desempates: nota > gols > assist+–ncias
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

    // ======= ASSIST+–NCIAS =======
    const assistsRanking = [...entries]
      .filter((e) => e.assists > 0 || e.goals > 0 || e.matches > 0)
      .sort((a, b) => {
        if (b.assists !== a.assists) return b.assists - a.assists;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.matches - a.matches;
      });

    // ======= GOLS + ASSIST+–NCIAS =======
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
      .map((e) => {
        const manual = e.player?.overallDynamic ?? e.player?.baseOverall ?? null;
        const score = manual != null ? Math.round(manual) : Math.round(e.overall);
        return { ...e, overallScore: score };
      })
      .sort((a, b) => {
        if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.goals !== a.goals) return b.goals - a.goals;
        return b.assists - a.assists;
      });

    // ======= PRESEN+–AS =======
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

    // ======= CRAQUES DO M+–S (contagem) =======
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

    const winnerColorWhere = { winnerColor: { not: null } };
    if (from && to) {
      winnerColorWhere.playedAt = { gte: from, lt: to };
    }

    const [winnerColorsRaw, totalWinnerColorsAll] = await Promise.all([
      prisma.match.findMany({
        where: winnerColorWhere,
        select: { winnerColor: true },
      }),
      prisma.match.count({
        where: { winnerColor: { not: null } },
      }),
    ]);

    const colorLabels = ["Amarelo", "Azul", "Preto", "Vermelho"];
    const fallbackColorCounts = {
      Amarelo: 9,
      Azul: 16,
      Preto: 6,
      Vermelho: 13,
    };

    const colorCounts = new Map(colorLabels.map((c) => [c, 0]));
    winnerColorsRaw.forEach((m) => {
      const color = (m.winnerColor || "").trim();
      if (!colorCounts.has(color)) return;
      colorCounts.set(color, (colorCounts.get(color) || 0) + 1);
    });

    const isYear2025 = String(year) === "2025";
    const isAllMonths = month === "0" || month === 0 || typeof month === "undefined";
    const useFallbackCounts = isYear2025 && isAllMonths && winnerColorsRaw.length === 0;
    const colorWins = colorLabels
      .map((name) => ({
        name,
        count: useFallbackCounts
          ? (fallbackColorCounts[name] || 0)
          : (colorCounts.get(name) || 0),
      }))
      .sort((a, b) => b.count - a.count);

    const last10Ranking = recentRanking.map((e) => ({
      ...e,
      last10Score: e.recentScore,
    }));

    const periodLabel = year === "all"
      ? "todos os anos"
      : (Number(month) > 0 ? `mes ${month} de ${year}` : `ano ${year}`);
    const posLabel = selPosition === "all" ? "todas as posicoes" : selPosition;
    const metaDescription = `Rankings ${periodLabel}, ${posLabel}.`;

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
      colorWins,
    };

    const payload = {
      title: "Rankings",
      rankings,
      year,
      month: Number(month),
      selPosition,
      currentYear,
      metaDescription,
      ogTitle: `Rankings ${periodLabel} | Horriver Plate`,
    };

    setCache(cacheKey, payload);
    return res.render("rankings", payload);

  } catch (err) {
    console.error("Erro ao carregar rankings:", err);
    return res.status(500).send("Erro ao carregar rankings.");
  }
});

module.exports = router;
