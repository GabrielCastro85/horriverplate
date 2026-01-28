// routes/vote.js
const express = require("express");
const crypto = require("crypto");
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

  const normalizePosition = (raw) => {
    const v = (raw || "").toString().toUpperCase();
    if (v.startsWith("GOL")) return "Goleiro";
    if (v.startsWith("ZA")) return "Zagueiro";
    if (v.startsWith("MEI")) return "Meia";
    if (v.startsWith("ATA")) return "Atacante";
    return "Outros";
  };

  const stats = await prisma.playerStat.findMany({
    where: { matchId: token.session.matchId, present: true },
    include: { player: true },
    orderBy: { player: { name: "asc" } },
  });

  if (!stats.length) {
    return { error: "Nenhum jogador presente registrado para esta pelada." };
  }

  const players = stats.map((s) => {
    const label = normalizePosition(s.player.position);
    return {
      ...s.player,
      positionLabel: label,
      goals: s.goals || 0,
      assists: s.assists || 0,
      appearedInPhoto: !!s.appearedInPhoto,
    };
  });

  const grouped = {};
  const groupedOrder = [];
  const order = ["Goleiro", "Zagueiro", "Meia", "Atacante"];
  order.forEach((label) => {
    const list = players.filter((p) => p.positionLabel === label);
    if (list.length) {
      grouped[label] = list;
      groupedOrder.push({ label, list });
    }
  });
  const others = players.filter((p) => !order.includes(p.positionLabel));
  if (others.length) {
    grouped.Outros = others;
    groupedOrder.push({ label: "Outros", list: others });
  }

  return {
    token,
    match: token.session.match,
    voter: token.player,
    players,
    grouped,
    groupedOrder,
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
      groupedOrder: [],
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
    groupedOrder: ctx.groupedOrder,
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
      groupedOrder: [],
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
      players.find((p) => p.id === bestOverallId) &&
      (!ctx.token?.player || bestOverallId !== ctx.token.player.id)
        ? bestOverallId
        : null;

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
      groupedOrder: ctx.groupedOrder,
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
      groupedOrder: ctx.groupedOrder,
      players: ctx.players,
      voter: ctx.voter,
      match: ctx.match,
      tokenValue,
    });
  }
});

// Alias legacy /votar/:token -> /vote/:token
router.get("/votar/:token", (req, res) => {
  return res.redirect(`/vote/${req.params.token}`);
});

// ==============================
// 🗳️ Votação Pública
// ==============================

// Carrega o contexto para a votação pública
async function loadPublicVoteContext(matchId, token) {
  if (!matchId || !token) {
    return { error: "Link de votação inválido ou ausente." };
  }

  const match = await prisma.match.findUnique({
    where: { id: Number(matchId) },
  });

  if (!match) {
    return { error: "Pelada não encontrada." };
  }

  if (match.votingStatus !== 'OPEN' || match.votingToken !== token) {
    return { error: "Este link de votação não está ativo ou é inválido." };
  }

  const stats = await prisma.playerStat.findMany({
    where: { matchId: match.id, present: true },
    include: { player: true },
    orderBy: { player: { name: "asc" } },
  });

  if (!stats.length) {
    return { error: "Nenhum jogador presente registrado para esta pelada." };
  }

  const normalizePosition = (raw) => {
    const v = (raw || "").toString().toUpperCase();
    if (v.startsWith("GOL")) return "Goleiro";
    if (v.startsWith("ZA")) return "Zagueiro";
    if (v.startsWith("MEI")) return "Meia";
    if (v.startsWith("ATA")) return "Atacante";
    return "Outros";
  };

  const players = stats.map((s) => {
    const label = normalizePosition(s.player.position);
    return {
      ...s.player,
      positionLabel: label,
      goals: s.goals || 0,
      assists: s.assists || 0,
      rating: s.rating,
      appearedInPhoto: !!s.appearedInPhoto,
    };
  });

  // agrupa preservando a ordem desejada
  const grouped = {};
  const groupedOrder = [];
  const order = ["Goleiro", "Zagueiro", "Meia", "Atacante"];
  order.forEach((label) => {
    const list = players.filter((p) => p.positionLabel === label);
    if (list.length) {
      grouped[label] = list;
      groupedOrder.push({ label, list });
    }
  });
  // demais posições aparecem em "Outros"
  const others = players.filter(
    (p) => !order.includes(p.positionLabel)
  );
  if (others.length > 0) {
    grouped["Outros"] = others;
    groupedOrder.push({ label: "Outros", list: others });
  }
  
  return { match, players, grouped, groupedOrder, token };
}


router.get("/match/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const { token } = req.query;

  const ctx = await loadPublicVoteContext(matchId, token);

  if (ctx.error) {
    // Render a simple error page if context fails
    return res.render("vote_page", {
      title: "Erro na Votação",
      error: ctx.error,
      match: null,
      players: [],
      grouped: {},
      groupedOrder: [],
      token: null,
      success: false,
    });
  }

  res.render("vote_page", {
    title: `Votação da Pelada`,
    error: null,
    match: ctx.match,
    players: ctx.players,
    grouped: ctx.grouped,
    groupedOrder: ctx.groupedOrder,
    token: ctx.token,
    success: false,
  });
});

router.post("/match/:matchId", async (req, res) => {
  const { matchId } = req.params;
  const { token } = req.query;

  const ctx = await loadPublicVoteContext(matchId, token);

  if (ctx.error) {
    return res.render("vote_page", {
      title: "Erro na Votação",
      error: ctx.error,
      match: null, players: [], grouped: {}, groupedOrder: [], token, success: false,
    });
  }

  // Voter identification
  let voterIdentifier = req.cookies[`vote_id_${matchId}`];
  if (!voterIdentifier) {
    voterIdentifier = crypto.randomBytes(16).toString("hex");
    // Set the cookie for future visits
    res.cookie(`vote_id_${matchId}`, voterIdentifier, { maxAge: 365 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' });
  }

  // Check if this identifier has already voted
  const existingVote = await prisma.publicVote.findUnique({
    where: {
      matchId_voterIdentifier: {
        matchId: ctx.match.id,
        voterIdentifier,
      }
    }
  });

  if (existingVote) {
    return res.render("vote_page", {
      title: "Votação Encerrada",
      error: "Você já votou nesta pelada.",
      match: ctx.match,
      players: ctx.players,
      grouped: ctx.grouped,
      groupedOrder: ctx.groupedOrder,
      token,
      success: false,
    });
  }

  try {
    const rankings = [];
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('rank-')) {
        const position = key.replace('rank-', '');
        const playerIds = req.body[key].split(',');
        playerIds.forEach((id, index) => {
          const playerId = parseInt(id, 10);
          if (!Number.isNaN(playerId)) {
            rankings.push({
              playerId,
              position,
              rank: index + 1,
            });
          }
        });
      }
    });

    const mvpPlayerIdRaw = req.body.mvpPlayerId;
    const mvpPlayerId = mvpPlayerIdRaw && ctx.players.some(p => p.id === parseInt(mvpPlayerIdRaw, 10)) 
      ? parseInt(mvpPlayerIdRaw, 10) 
      : null;

    await prisma.publicVote.create({
      data: {
        matchId: ctx.match.id,
        voterIdentifier,
        mvpPlayerId: mvpPlayerId,
        rankings: {
          create: rankings,
        },
      },
    });

    return res.render("vote_page", {
      title: "Obrigado por Votar!",
      error: null,
      match: ctx.match,
      players: [],
      grouped: {},
      groupedOrder: [],
      token,
      success: true, // To show a success message
    });

  } catch (err) {
    console.error("Erro ao salvar voto público:", err);
    if (err.code === 'P2002') { // Unique constraint violation
         return res.render("vote_page", {
            title: "Votação Encerrada",
            error: "Seu voto já foi computado.",
            match: ctx.match, players: ctx.players, grouped: ctx.grouped, groupedOrder: ctx.groupedOrder, token, success: false,
        });
    }
    return res.render("vote_page", {
      title: "Erro na Votação",
      error: "Ocorreu um erro ao salvar seu voto. Tente novamente.",
      match: ctx.match, players: ctx.players, grouped: ctx.grouped, groupedOrder: ctx.groupedOrder, token, success: false,
    });
  }
});


module.exports = router;
