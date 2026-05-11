const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { getDynamicOverallSnapshot } = require("../utils/live_overall");
const { computeOverallFromEntries } = require("../utils/overall");

async function buildCompareViewModel(req, id) {
  const player = await prisma.player.findUnique({
    where: { id },
    include: {
      stats: { include: { match: true }, orderBy: { match: { playedAt: "desc" } } },
      overallHistory: { orderBy: { calculatedAt: "desc" }, take: 12 },
    },
  });
  if (!player) return null;

  const { scoreMap } = await getDynamicOverallSnapshot();

  const totals = {
    goals: player.totalGoals || 0,
    assists: player.totalAssists || 0,
    matches: player.totalMatches || 0,
    photos: player.totalPhotos || 0,
    saves: player.stats.reduce((s, st) => s + (st.saves || 0), 0),
  };

  const presentStats = player.stats.filter((s) => s.present && s.rating != null);
  totals.avgRating =
    presentStats.length > 0
      ? presentStats.reduce((s, st) => s + (st.rating || 0), 0) / presentStats.length
      : null;

  // Overall series (same logic as player profile)
  const overallHistory = player.overallHistory || [];
  let overallSeries;
  if (overallHistory.length > 0) {
    overallSeries = overallHistory
      .slice(0, 12)
      .map((o) => ({ date: o.calculatedAt, overall: o.overall }))
      .reverse();
  } else {
    const chronoStats = [...player.stats]
      .filter((s) => s.match?.playedAt)
      .sort((a, b) => new Date(a.match.playedAt) - new Date(b.match.playedAt));
    let g = 0, a = 0, m = 0, rSum = 0, rCount = 0;
    overallSeries = [];
    chronoStats.forEach((s) => {
      if (!s.present) return;
      g += s.goals || 0; a += s.assists || 0; m += 1;
      if (s.rating != null) { rSum += s.rating; rCount += 1; }
      const { computed } = computeOverallFromEntries([{
        player, goals: g, assists: a, matches: m, rating: rCount ? rSum / rCount : 0,
      }]);
      if (computed?.length) overallSeries.push({ date: s.match.playedAt, overall: computed[0].overall });
    });
  }

  let latestOverall = scoreMap.get(player.id) ??
    (overallSeries.length ? overallSeries[overallSeries.length - 1].overall : null) ??
    Math.round(player.baseOverall || 60);

  if (!overallSeries.length) overallSeries = [{ date: new Date(), overall: latestOverall }];

  return { player, totals, overallSeries, latestOverall };
}

// GET /comparar — selector page
router.get("/", async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, nickname: true, position: true, photoUrl: true },
    });
    return res.render("comparar", {
      title: "Comparar Jogadores",
      activePage: "elenco",
      players,
      playerA: null,
      playerB: null,
    });
  } catch (err) {
    console.error("Erro em GET /comparar:", err);
    res.status(500).send("Erro ao carregar comparador.");
  }
});

// GET /comparar/:id1/:id2 — side-by-side comparison
router.get("/:id1/:id2", async (req, res) => {
  try {
    const id1 = Number(req.params.id1);
    const id2 = Number(req.params.id2);
    if (Number.isNaN(id1) || Number.isNaN(id2)) return res.redirect("/comparar");

    const [playerA, playerB, allPlayers] = await Promise.all([
      buildCompareViewModel(req, id1),
      buildCompareViewModel(req, id2),
      prisma.player.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, nickname: true, position: true, photoUrl: true },
      }),
    ]);

    if (!playerA || !playerB) return res.redirect("/comparar");

    return res.render("comparar", {
      title: `${playerA.player.name} vs ${playerB.player.name}`,
      activePage: "elenco",
      players: allPlayers,
      playerA,
      playerB,
    });
  } catch (err) {
    console.error("Erro em GET /comparar/:id1/:id2:", err);
    res.status(500).send("Erro ao comparar jogadores.");
  }
});

module.exports = router;
