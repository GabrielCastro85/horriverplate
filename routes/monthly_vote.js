// routes/monthly_vote.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const rateLimit = require("express-rate-limit");
const {
  attachSelectionPhotos,
  getSelectionGroupsForVoter,
  parseSelectionFromBody,
} = require("../utils/monthly_selection");

const voteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).send("Muitas tentativas. Tente novamente em alguns minutos.");
  },
});

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Mar\u00E7o",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

async function loadMonthlyVoteContext(tokenValue) {
  if (!tokenValue) return { error: "Token inválido." };

  const token = await prisma.monthlyVoteToken.findUnique({
    where: { token: tokenValue },
    include: {
      session: true,
      player: true,
    },
  });

  if (!token) return { error: "Token inválido." };
  if (token.usedAt) return { error: "Este link já foi usado para votar." };

  const now = new Date();
  if (token.session?.expiresAt && token.session.expiresAt < now) {
    return { error: "Este link expirou." };
  }

  const candidates = Array.isArray(token.session?.candidates)
    ? token.session.candidates
    : [];

  if (!candidates.length) {
    return { error: "Nenhum candidato disponível para esta votação." };
  }

  const monthLabel = token.session
    ? `${monthNames[token.session.month - 1]} ${token.session.year}`
    : "";

  const selectionGroups = getSelectionGroupsForVoter(token.session?.selectionCandidates, token.playerId);
  await attachSelectionPhotos(prisma, selectionGroups.flatMap((group) => group.options));

  return {
    token,
    voter: token.player,
    candidates,
    selectionGroups,
    monthLabel,
    session: token.session,
  };
}

function renderVote(res, token, ctx, extra = {}) {
  return res.render("monthly_vote", {
    title: "Votação do mês",
    error: null,
    success: false,
    candidates: ctx?.candidates || [],
    selectionGroups: ctx?.selectionGroups || [],
    voter: ctx?.voter || null,
    monthLabel: ctx?.monthLabel || "",
    selectedCandidateId: null,
    selectedByGroup: {},
    token,
    ...extra,
  });
}

router.get("/:token", async (req, res) => {
  const { token } = req.params;
  const ctx = await loadMonthlyVoteContext(token);
  if (ctx.error) return renderVote(res, token, null, { error: ctx.error });
  return renderVote(res, token, ctx);
});

router.post("/:token", voteLimiter, async (req, res) => {
  const { token } = req.params;
  const ctx = await loadMonthlyVoteContext(token);
  if (ctx.error) return renderVote(res, token, null, { error: ctx.error });

  const rawCandidate = req.body?.candidateId;
  const candidateId = rawCandidate ? Number(rawCandidate) : null;
  const validCandidate = ctx.candidates.find((c) => Number(c.id) === candidateId);
  const selection = parseSelectionFromBody(req.body, ctx.selectionGroups);
  const keepChoices = {
    selectedCandidateId: validCandidate ? candidateId : null,
    selectedByGroup: selection.selectedByGroup,
  };

  if (!validCandidate) {
    return renderVote(res, token, ctx, { ...keepChoices, error: "Selecione um craque do mês válido." });
  }
  if (selection.error) {
    return renderVote(res, token, ctx, { ...keepChoices, error: selection.error });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Marca o token primeiro: um segundo envio simultâneo não passa daqui.
      const claimed = await tx.monthlyVoteToken.updateMany({
        where: { id: ctx.token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) throw new Error("TOKEN_USED");

      await tx.monthlyVoteBallot.create({
        data: {
          tokenId: ctx.token.id,
          candidateId,
        },
      });

      if (selection.picks.length) {
        await tx.monthlySelectionVote.createMany({
          data: selection.picks.map((pick) => ({ ...pick, tokenId: ctx.token.id })),
        });
      }
    });

    return renderVote(res, token, ctx, { success: true });
  } catch (err) {
    if (err.message === "TOKEN_USED") {
      return renderVote(res, token, null, { error: "Este link já foi usado para votar." });
    }
    console.error("Erro ao registrar voto mensal:", err);
    return renderVote(res, token, ctx, { ...keepChoices, error: "Erro ao registrar o voto. Tente novamente." });
  }
});

module.exports = router;
