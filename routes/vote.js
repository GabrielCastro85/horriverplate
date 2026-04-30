// routes/vote.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../utils/db");
const { detectSuspiciousVotePattern } = require("../helpers/weeklyVoteValidation.helper");

const TEAM_COLOR_THEMES = {
  Amarelo: { dot: "#facc15", soft: "rgba(250, 204, 21, 0.14)", border: "rgba(250, 204, 21, 0.55)" },
  Azul: { dot: "#38bdf8", soft: "rgba(56, 189, 248, 0.14)", border: "rgba(56, 189, 248, 0.55)" },
  Preto: { dot: "#e5e7eb", soft: "rgba(229, 231, 235, 0.10)", border: "rgba(229, 231, 235, 0.34)" },
  Vermelho: { dot: "#ef4444", soft: "rgba(239, 68, 68, 0.14)", border: "rgba(239, 68, 68, 0.48)" },
  Branco: { dot: "#f8fafc", soft: "rgba(248, 250, 252, 0.11)", border: "rgba(248, 250, 252, 0.40)" },
  Laranja: { dot: "#ff7a1a", soft: "rgba(255, 122, 26, 0.14)", border: "rgba(255, 122, 26, 0.50)" },
};

function normalizeTeamColorName(value, fallbackIndex = 0) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("amare")) return "Amarelo";
  if (raw.includes("azul")) return "Azul";
  if (raw.includes("pret")) return "Preto";
  if (raw.includes("vermel")) return "Vermelho";
  if (raw.includes("branc")) return "Branco";
  if (raw.includes("laranja") || raw.includes("goleir")) return "Laranja";
  return ["Amarelo", "Azul", "Preto", "Vermelho"][fallbackIndex % 4];
}

function positionRank(position = "") {
  const value = String(position).toLowerCase();
  if (value.includes("gol")) return 0;
  if (value.includes("zag")) return 1;
  if (value.includes("vol")) return 2;
  if (value.includes("mei")) return 3;
  if (value.includes("ata")) return 4;
  return 5;
}

async function decoratePlayersWithLineup(matchId, players) {
  const latestLineup = await prisma.lineupDraw.findFirst({
    where: { matchId },
    orderBy: { createdAt: "desc" },
  });

  const playerById = new Map(players.map((player) => [String(player.id), player]));
  const ordered = [];
  const included = new Set();

  if (latestLineup?.result && Array.isArray(latestLineup.result.teams)) {
    latestLineup.result.teams.forEach((team, teamIndex) => {
      const colorName = normalizeTeamColorName(team?.colorName || team?.name, teamIndex);
      const theme = TEAM_COLOR_THEMES[colorName] || TEAM_COLOR_THEMES.Laranja;
      const teamName = team?.name || `Time ${colorName}`;
      const teamPlayers = (Array.isArray(team?.players) ? team.players : [])
        .map((entry) => playerById.get(String(entry?.id)))
        .filter(Boolean)
        .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name, "pt-BR"));

      teamPlayers.forEach((player) => {
        included.add(String(player.id));
        ordered.push({
          ...player,
          teamName,
          teamColorName: colorName,
          teamTheme: theme,
          teamOrder: teamIndex,
        });
      });
    });
  }

  const fallbackTheme = TEAM_COLOR_THEMES.Laranja;
  const extras = players
    .filter((player) => !included.has(String(player.id)))
    .sort((a, b) => positionRank(a.position) - positionRank(b.position) || a.name.localeCompare(b.name, "pt-BR"))
    .map((player) => ({
      ...player,
      teamName: "Goleiros",
      teamColorName: "Laranja",
      teamTheme: fallbackTheme,
      teamOrder: 999,
    }));

  return ordered.length || extras.length ? [...ordered, ...extras] : players;
}

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
    select: {
      playerId: true,
      goals: true,
      assists: true,
      saves: true,
      appearedInPhoto: true,
      player: {
        select: {
          id: true,
          name: true,
          nickname: true,
          position: true,
          photoUrl: true,
        },
      },
    },
    orderBy: { player: { name: "asc" } },
  });

  if (!stats.length) {
    return { error: "Nenhum jogador presente registrado para esta pelada." };
  }

  const playersRaw = stats.map((s) => {
    const label = normalizePosition(s.player.position);
    return {
      id: s.player.id,
      name: s.player.name,
      nickname: s.player.nickname,
      position: s.player.position,
      positionLabel: label,
      photoUrl: s.player.photoUrl || null,
      goals: s.goals || 0,
      assists: s.assists || 0,
      saves: s.saves,
      rating: s.rating,
      appearedInPhoto: !!s.appearedInPhoto,
    };
  });
  const filteredPlayers = token.player
    ? playersRaw.filter((p) => p.id !== token.player.id)
    : playersRaw;
  const players = await decoratePlayersWithLineup(token.session.matchId, filteredPlayers);
  if (!players.length) {
    return { error: "Nenhum jogador disponivel para votar." };
  }

  return {
    token,
    match: token.session.match,
    voter: token.player,
    players,
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
      voteSabotageAlert: null,
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
    voteSabotageAlert: null,
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
      voteSabotageAlert: null,
      players: [],
      voter: null,
      match: null,
      tokenValue,
    });
  }

  try {
    const players = ctx.players;
    const ratings = [];
    let missing = false;

    players.forEach((p) => {
      const key = `rating_${p.id}`;
      const raw = req.body[key];
      if (raw == null || raw === "") {
        missing = true;
        return;
      }
      const rating = parseInt(raw, 10);
      if (Number.isNaN(rating) || rating < 1 || rating > 5) {
        missing = true;
        return;
      }
      ratings.push({ playerId: p.id, rating });
    });

    if (missing || ratings.length !== players.length) {
      return res.render("vote_token", {
        title: "Votacao",
        error: "Preencha todas as notas de 1 a 5 para continuar.",
        success: false,
        voteSabotageAlert: null,
        players: ctx.players,
        voter: ctx.voter,
        match: ctx.match,
        tokenValue,
      });
    }

    const validation = detectSuspiciousVotePattern(ratings);

    await prisma.$transaction(async (tx) => {
      await tx.voteBallot.create({
        data: {
          voteTokenId: ctx.token.id,
          isInvalid: validation.isInvalid,
          invalidCode: validation.invalidCode,
          invalidReason: validation.invalidReason,
          ratings: {
            create: ratings,
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
      voteSabotageAlert: validation.isInvalid
        ? {
            show: true,
            imageSrc: "/img/image-42.svg",
            title: "TO DE OLHO NO VACILO, CRAQUE",
          }
        : null,
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
      voteSabotageAlert: null,
      players: ctx.players,
      voter: ctx.voter,
      match: ctx.match,
      tokenValue,
    });
  }
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
    select: {
      playerId: true,
      goals: true,
      assists: true,
      rating: true,
      appearedInPhoto: true,
      player: {
        select: {
          id: true,
          name: true,
          nickname: true,
          position: true,
          photoUrl: true,
        },
      },
    },
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

function getPublicToken(req) {
  return req.params?.token || req.query?.token || null;
}

async function renderPublicVote(req, res) {
  const { matchId } = req.params;
  const token = getPublicToken(req);
  const ctx = await loadPublicVoteContext(matchId, token);

  if (ctx.error) {
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
}

async function handlePublicVote(req, res) {
  const { matchId } = req.params;
  const token = getPublicToken(req);

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
    res.cookie(`vote_id_${matchId}`, voterIdentifier, {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
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
}


router.get("/match/:matchId/:token", renderPublicVote);
router.post("/match/:matchId/:token", handlePublicVote);
router.get("/match/:matchId", renderPublicVote);
router.post("/match/:matchId", handlePublicVote);


module.exports = router;
