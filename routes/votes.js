const express = require("express");
const prisma = require("../utils/db");

const router = express.Router();

function normalizePosition(position) {
  if (!position) return "";
  return position.toLowerCase();
}

function filterByKeywords(players, keywords) {
  return players.filter((player) => {
    const pos = normalizePosition(player.position);
    return keywords.some((keyword) => pos.includes(keyword));
  });
}

function buildOptions(presentPlayers) {
  const goalkeepers = filterByKeywords(presentPlayers, ["gol", "goleiro"]);
  const defenders = filterByKeywords(presentPlayers, ["zag", "def"]); // zagueiro, defensor
  const midfielders = filterByKeywords(presentPlayers, ["mei", "vol", "meia", "meio"]);
  const forwards = filterByKeywords(presentPlayers, ["ata", "pont", "ala", "centro", "fim"]);

  return {
    goalkeepers: goalkeepers.length ? goalkeepers : presentPlayers,
    defenders: defenders.length ? defenders : presentPlayers,
    midfielders: midfielders.length ? midfielders : presentPlayers,
    forwards: forwards.length ? forwards : presentPlayers,
    all: presentPlayers,
  };
}

async function loadTokenWithContext(tokenValue) {
  const voteLink = await prisma.voteLink.findUnique({
    where: { token: tokenValue },
    include: {
      player: true,
      match: true,
    },
  });

  if (!voteLink) return null;

  const presentStats = await prisma.playerStat.findMany({
    where: { matchId: voteLink.matchId, present: true },
    include: { player: true },
    orderBy: { player: { name: "asc" } },
  });

  const presentPlayers = presentStats.map((stat) => stat.player);

  return { voteLink, presentPlayers };
}

router.get("/:token", async (req, res) => {
  const tokenValue = req.params.token;

  const tokenContext = await loadTokenWithContext(tokenValue);
  if (!tokenContext) {
    return res.status(404).render("vote_status", {
      title: "Link inválido",
      status: "error",
      message: "Link de votação não encontrado ou já removido.",
    });
  }

  const { voteLink, presentPlayers } = tokenContext;

  if (voteLink.usedAt) {
    return res.status(400).render("vote_status", {
      title: "Voto já registrado",
      status: "used",
      message: "Este link único já foi utilizado para votar nesta pelada.",
      voteLink,
    });
  }

  const options = buildOptions(presentPlayers);

  return res.render("vote_form", {
    title: "Votar na pelada",
    voteLink,
    presentPlayers,
    options,
  });
});

router.post("/:token", async (req, res) => {
  const tokenValue = req.params.token;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const voteLink = await tx.voteLink.findUnique({
        where: { token: tokenValue },
        include: { match: true, player: true },
      });

      if (!voteLink) {
        throw new Error("LINK_NOT_FOUND");
      }

      if (voteLink.usedAt) {
        throw new Error("LINK_ALREADY_USED");
      }

      const presentStats = await tx.playerStat.findMany({
        where: { matchId: voteLink.matchId, present: true },
        select: { playerId: true },
      });

      const allowedIds = new Set(presentStats.map((stat) => stat.playerId));

      const parseCandidate = (value) => {
        if (!value) return null;
        const parsed = Number(value);
        if (Number.isNaN(parsed)) return null;
        return allowedIds.has(parsed) ? parsed : null;
      };

      const voteData = {
        matchId: voteLink.matchId,
        voterId: voteLink.playerId,
        tokenId: voteLink.id,
        bestGoalkeeperId: parseCandidate(req.body.bestGoalkeeperId),
        bestDefenderId: parseCandidate(req.body.bestDefenderId),
        bestMidfielderId: parseCandidate(req.body.bestMidfielderId),
        bestForwardId: parseCandidate(req.body.bestForwardId),
        bestOverallId: parseCandidate(req.body.bestOverallId),
      };

      await tx.vote.create({ data: voteData });

      await tx.voteLink.update({
        where: { id: voteLink.id },
        data: { usedAt: new Date() },
      });

      return voteLink;
    });

    return res.render("vote_status", {
      title: "Voto registrado",
      status: "success",
      message: "Valeu! Seu voto único foi registrado com sucesso.",
      voteLink: result,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "LINK_NOT_FOUND") {
      return res.status(404).render("vote_status", {
        title: "Link inválido",
        status: "error",
        message: "Link de votação não encontrado ou já removido.",
      });
    }

    if (err instanceof Error && err.message === "LINK_ALREADY_USED") {
      return res.status(400).render("vote_status", {
        title: "Voto já registrado",
        status: "used",
        message: "Este link único já foi utilizado para votar nesta pelada.",
      });
    }

    console.error("Erro ao registrar voto", err);
    return res.status(500).render("vote_status", {
      title: "Erro ao registrar voto",
      status: "error",
      message: "Não conseguimos salvar o voto agora. Tente novamente em alguns minutos.",
    });
  }
});

module.exports = router;
