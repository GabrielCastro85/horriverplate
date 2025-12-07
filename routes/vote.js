// routes/vote.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

async function loadContext(tokenValue) {
  if (!tokenValue) return { error: "Token inválido." };

  const token = await prisma.voteToken.findUnique({
    where: { token: tokenValue },
    include: {
      session: {
        include: { match: true },
      },
      player: true,
    },
  });

  if (!token) return { error: "Token inválido." };
  if (token.usedAt) return { error: "Este link já foi usado para votar." };

  const now = new Date();
  if (token.session?.expiresAt && token.session.expiresAt < now) {
    return { error: "Este link expirou." };
  }

  const stats = await prisma.playerStat.findMany({
    where: { matchId: token.session.matchId, present: true },
    include: { player: true },
    orderBy: { player: { name: "asc" } },
  });

  if (!stats.length) {
    return { error: "Nenhum jogador presente registrado para esta pelada." };
  }

  const players = stats.map((s) => s.player);

  const positions = ["Goleiro", "Zagueiro", "Meia", "Atacante"];
  const grouped = {};
  positions.forEach((pos) => {
    grouped[pos] = players.filter((p) => p.position === pos);
  });
  grouped.Outros = players.filter((p) => !positions.includes(p.position));

  return {
    token,
    match: token.session.match,
    voter: token.player,
    players,
    grouped,
  };
}

router.get("/:token", async (req, res) => {
  const tokenValue = req.params.token;
  const ctx = await loadContext(tokenValue);

  if (ctx.error) {
    return res.render("vote_token", {
      title: "Votação",
      error: ctx.error,
      success: false,
      grouped: {},
      players: [],
      voter: null,
      match: null,
      tokenValue,
    });
  }

  return res.render("vote_token", {
    title: "Votação",
    error: null,
    success: false,
    grouped: ctx.grouped,
    players: ctx.players,
    voter: ctx.voter,
    match: ctx.match,
    tokenValue,
  });
});

router.post("/:token", async (req, res) => {
  const tokenValue = req.params.token;
  const ctx = await loadContext(tokenValue);

  if (ctx.error) {
    return res.render("vote_token", {
      title: "Votação",
      error: ctx.error,
      success: false,
      grouped: {},
      players: [],
      voter: null,
      match: null,
      tokenValue,
    });
  }

  try {
    const players = ctx.players;
    const rankings = [];

    players.forEach((p) => {
      const key = `rank_${p.position}_${p.id}`;
      const raw = req.body[key];
      if (raw == null || raw === "") return;
      const rank = parseInt(raw, 10);
      if (Number.isNaN(rank) || rank <= 0) return;
      rankings.push({
        position: p.position || "Outros",
        playerId: p.id,
        rank,
      });
    });

    const bestOverallRaw = req.body.bestOverall;
    const bestOverallId =
      bestOverallRaw && bestOverallRaw !== ""
        ? parseInt(bestOverallRaw, 10)
        : null;
    const validBest =
      bestOverallId &&
      players.find((p) => p.id === bestOverallId) ? bestOverallId : null;

    await prisma.$transaction(async (tx) => {
      await tx.voteBallot.create({
        data: {
          voteTokenId: ctx.token.id,
          bestOverallPlayerId: validBest,
          rankings: {
            create: rankings,
          },
        },
      });

      await tx.voteToken.update({
        where: { id: ctx.token.id },
        data: { usedAt: new Date() },
      });
    });

    return res.render("vote_token", {
      title: "Votação",
      error: null,
      success: true,
      grouped: ctx.grouped,
      players: ctx.players,
      voter: ctx.voter,
      match: ctx.match,
      tokenValue,
    });
  } catch (err) {
    console.error("Erro ao salvar voto:", err);
    return res.render("vote_token", {
      title: "Votação",
      error: "Erro ao registrar o voto. Tente novamente.",
      success: false,
      grouped: ctx.grouped,
      players: ctx.players,
      voter: ctx.voter,
      match: ctx.match,
      tokenValue,
    });
  }
});

module.exports = router;
