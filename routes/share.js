const express = require("express");
const path = require("path");
const prisma = require("../utils/db");
const { renderSharePng } = require("../services/shareImage.service");

const router = express.Router();

const fmt = (num, digits = 0) => {
  if (num == null) return "0";
  return Number(num).toFixed(digits).replace(".", ",");
};

function parseScope(query) {
  const scope = query.scope || "all";
  const month = Number(query.month) || null;
  const year = Number(query.year) || null;
  return { scope, month, year };
}

function filterByScope(stats, { scope, month, year }) {
  return stats.filter((s) => {
    if (!s.match) return true;
    const playedAt = new Date(s.match.playedAt);
    const m = playedAt.getMonth() + 1;
    const y = playedAt.getFullYear();
    if (scope === "month") return m === month && y === year;
    if (scope === "year") return y === year;
    return true; // all
  });
}

async function fetchPlayerStatsWithMatch() {
  return prisma.playerStat.findMany({
    include: {
      player: true,
      match: true,
    },
  });
}

function aggregateTop(stats, type, scopeFilter) {
  const filtered = filterByScope(stats, scopeFilter);
  const acc = new Map();
  filtered.forEach((s) => {
    const pid = s.playerId;
    if (!pid) return;
    const entry = acc.get(pid) || {
      player: s.player,
      goals: 0,
      assists: 0,
      ratings: [],
      matches: 0,
    };
    entry.goals += s.goals || 0;
    entry.assists += s.assists || 0;
    if (s.rating != null) entry.ratings.push(Number(s.rating));
    entry.matches += 1;
    acc.set(pid, entry);
  });

  const result = Array.from(acc.values()).map((e) => {
    const ratingAvg =
      e.ratings.length > 0
        ? e.ratings.reduce((sum, v) => sum + v, 0) / e.ratings.length
        : 0;
    return {
      player: e.player,
      goals: e.goals,
      assists: e.assists,
      ga: e.goals + e.assists,
      rating: ratingAvg,
      matches: e.matches,
    };
  });

  const minMatches = scopeFilter.scope === "month" ? 2 : scopeFilter.scope === "year" ? 5 : 1;

  const sortKey = (row) => {
    if (type === "assists") return row.assists;
    if (type === "ga") return row.ga;
    if (type === "rating") return row.matches >= minMatches ? row.rating : -Infinity;
    return row.goals; // default goals
  };

  return result
    .filter((r) => (type === "rating" ? r.matches >= minMatches : true))
    .sort((a, b) => sortKey(b) - sortKey(a) || (b.player.overallDynamic ?? 0) - (a.player.overallDynamic ?? 0))
    .slice(0, 10)
    .map((r, idx) => ({
      rank: idx + 1,
      name: r.player.name,
      position: r.player.position || "",
      photo: r.player.photoUrl || "/img/logo.jpg",
      goals: r.goals,
      assists: r.assists,
      rating: fmt(r.rating, 2),
      metric:
        type === "assists"
          ? r.assists
          : type === "ga"
          ? r.ga
          : type === "rating"
          ? fmt(r.rating, 2)
          : r.goals,
    }));
}

router.get("/top10.png", async (req, res) => {
  try {
    const type = req.query.type || "goals";
    const format = req.query.format || "story";
    const scopeFilter = parseScope(req.query);
    const stats = await fetchPlayerStatsWithMatch();
    const top = await aggregateTop(stats, type, scopeFilter);

    const templateData = {
      title: "Top 10",
      subtitle:
        type === "assists"
          ? "Assistências"
          : type === "ga"
          ? "Participações"
          : type === "rating"
          ? "Notas"
          : "Gols",
      items: top,
      format,
      scope: scopeFilter,
    };

    const buffer = await renderSharePng({
      templateName: path.join("share", "top10.ejs"),
      data: templateData,
      format,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("Erro ao gerar top10.png", err);
    try {
      const fs = require("fs");
      fs.appendFileSync(
        "share-error.log",
        `[${new Date().toISOString()}] top10 ${err?.stack || err}\n`
      );
    } catch {}
    res.status(500).type("text/plain").send("Erro ao gerar imagem");
  }
});

router.get("/craque-mes.png", async (req, res) => {
  try {
    const format = req.query.format || "story";
    const { month, year } = parseScope({ scope: "month", ...req.query });
    const stats = await fetchPlayerStatsWithMatch();
    const filtered = filterByScope(stats, { scope: "month", month, year });
    const grouped = new Map();
    filtered.forEach((s) => {
      if (!s.playerId) return;
      const e = grouped.get(s.playerId) || { player: s.player, ratings: [], goals: 0, assists: 0, matches: 0 };
      if (s.rating != null) e.ratings.push(Number(s.rating));
      e.goals += s.goals || 0;
      e.assists += s.assists || 0;
      e.matches += 1;
      grouped.set(s.playerId, e);
    });
    const best = Array.from(grouped.values())
      .map((e) => ({
        ...e,
        rating: e.ratings.length ? e.ratings.reduce((a, b) => a + b, 0) / e.ratings.length : 0,
      }))
      .filter((e) => e.matches >= 2)
      .sort((a, b) => b.rating - a.rating || b.goals - a.goals || b.assists - a.assists)[0];

    const templateData = {
      title: "Craque do mês",
      month,
      year,
      player: best
        ? {
            name: best.player.name,
            position: best.player.position || "",
            photo: best.player.photoUrl || "/img/logo.jpg",
            rating: fmt(best.rating, 2),
            goals: best.goals,
            assists: best.assists,
            matches: best.matches,
          }
        : null,
      format,
    };

    const buffer = await renderSharePng({
      templateName: path.join("share", "craque_mes.ejs"),
      data: templateData,
      format,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("Erro ao gerar craque-mes.png", err);
    res.status(500).type("text/plain").send("Erro ao gerar imagem");
  }
});

router.get("/craque-semana.png", async (req, res) => {
  try {
    const format = req.query.format || "story";
    const matchId = Number(req.query.matchId) || null;
    if (!matchId) return res.status(400).type("text/plain").send("matchId obrigatório");

    const stats = await prisma.playerStat.findMany({
      where: { matchId },
      include: { player: true },
    });
    const best = stats
      .map((s) => ({
        player: s.player,
        rating: s.rating != null ? Number(s.rating) : 0,
        goals: s.goals || 0,
        assists: s.assists || 0,
      }))
      .sort((a, b) => b.rating - a.rating || b.goals - a.goals || b.assists - a.assists)[0];

    const templateData = {
      title: "Craque da semana",
      player: best
        ? {
            name: best.player.name,
            position: best.player.position || "",
            photo: best.player.photoUrl || "/img/logo.jpg",
            rating: fmt(best.rating, 2),
            goals: best.goals,
            assists: best.assists,
          }
        : null,
      format,
    };

    const buffer = await renderSharePng({
      templateName: path.join("share", "craque_semana.ejs"),
      data: templateData,
      format,
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=60");
    res.end(Buffer.from(buffer));
  } catch (err) {
    console.error("Erro ao gerar craque-semana.png", err);
    res.status(500).type("text/plain").send("Erro ao gerar imagem");
  }
});

module.exports = router;
