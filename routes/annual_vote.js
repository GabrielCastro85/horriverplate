// routes/annual_vote.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const rateLimit = require("express-rate-limit");
const { attachSelectionPhotos } = require("../utils/monthly_selection");
const {
  getAnnualBallotGroups,
  getAnnualVoteStatus,
  parseAnnualBallot,
} = require("../utils/annual_vote");

const voteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).send("Muitas tentativas. Tente novamente em alguns minutos.");
  },
});

function formatDateTimeBR(date) {
  return new Date(date).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadAnnualVoteContext(tokenValue) {
  const token = tokenValue
    ? await prisma.annualVoteToken.findUnique({
        where: { token: tokenValue },
        include: {
          session: true,
          player: { select: { id: true, name: true } },
        },
      })
    : null;

  if (!token) return { error: "Link inválido." };
  if (token.usedAt) return { error: "Este link já foi usado para votar." };

  const status = getAnnualVoteStatus(token.session);
  if (status === "scheduled") {
    return { error: `A votação abre em ${formatDateTimeBR(token.session.opensAt)}. Guarde este link!` };
  }
  if (status === "closed") return { error: "A votação já foi encerrada." };

  const groups = getAnnualBallotGroups(token.session.candidates, token.playerId);
  if (!groups.length) return { error: "Nenhum candidato disponível para esta votação." };
  await attachSelectionPhotos(prisma, groups.flatMap((group) => group.options));

  return {
    token,
    voter: token.player,
    groups,
    year: token.session.year,
    closesAtLabel: formatDateTimeBR(token.session.expiresAt),
  };
}

function renderVote(res, ctx, extra = {}) {
  return res.render("annual_vote", {
    title: "Melhores do ano",
    error: null,
    success: false,
    groups: ctx?.groups || [],
    voter: ctx?.voter || null,
    year: ctx?.year || null,
    closesAtLabel: ctx?.closesAtLabel || null,
    selectedByCategory: {},
    ...extra,
  });
}

router.get("/:token", async (req, res) => {
  const ctx = await loadAnnualVoteContext(req.params.token);
  if (ctx.error) return renderVote(res, null, { error: ctx.error });
  return renderVote(res, ctx);
});

router.post("/:token", voteLimiter, async (req, res) => {
  const ctx = await loadAnnualVoteContext(req.params.token);
  if (ctx.error) return renderVote(res, null, { error: ctx.error });

  const ballot = parseAnnualBallot(req.body, ctx.groups);
  if (ballot.error) {
    return renderVote(res, ctx, { error: ballot.error, selectedByCategory: ballot.selectedByCategory });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Marca o token primeiro: um segundo envio simultâneo não passa daqui.
      const claimed = await tx.annualVoteToken.updateMany({
        where: { id: ctx.token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (!claimed.count) throw new Error("TOKEN_USED");

      await tx.annualVotePick.createMany({
        data: ballot.picks.map((pick) => ({ ...pick, tokenId: ctx.token.id })),
      });
    });

    return renderVote(res, ctx, { success: true });
  } catch (err) {
    if (err.message === "TOKEN_USED") {
      return renderVote(res, null, { error: "Este link já foi usado para votar." });
    }
    console.error("Erro ao registrar voto anual:", err);
    return renderVote(res, ctx, {
      error: "Erro ao registrar o voto. Tente novamente.",
      selectedByCategory: ballot.selectedByCategory,
    });
  }
});

module.exports = router;
