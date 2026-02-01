// routes/monthly_vote.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Mar–o",
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
  if (token.usedAt) return { error: "Este link j– foi usado para votar." };

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

  return {
    token,
    voter: token.player,
    candidates,
    monthLabel,
    session: token.session,
  };
}

router.get("/:token", async (req, res) => {
  const { token } = req.params;
  const ctx = await loadMonthlyVoteContext(token);

  if (ctx.error) {
    return res.render("monthly_vote", {
      title: "Votação do mês",
      error: ctx.error,
      success: false,
      candidates: [],
      voter: null,
      monthLabel: "",
      token,
    });
  }

  return res.render("monthly_vote", {
    title: "Votação do mês",
    error: null,
    success: false,
    candidates: ctx.candidates,
    voter: ctx.voter,
    monthLabel: ctx.monthLabel,
    token,
  });
});

router.post("/:token", async (req, res) => {
  const { token } = req.params;
  const ctx = await loadMonthlyVoteContext(token);

  if (ctx.error) {
    return res.render("monthly_vote", {
      title: "Votação do mês",
      error: ctx.error,
      success: false,
      candidates: [],
      voter: null,
      monthLabel: "",
      token,
    });
  }

  try {
    const rawCandidate = req.body?.candidateId;
    const candidateId = rawCandidate ? Number(rawCandidate) : null;
    const validCandidate = ctx.candidates.find((c) => Number(c.id) === candidateId);

    if (!validCandidate) {
      return res.render("monthly_vote", {
        title: "Votação do mês",
        error: "Selecione um candidato válido.",
        success: false,
        candidates: ctx.candidates,
        voter: ctx.voter,
        monthLabel: ctx.monthLabel,
        token,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.monthlyVoteBallot.create({
        data: {
          tokenId: ctx.token.id,
          candidateId: candidateId,
        },
      });

      await tx.monthlyVoteToken.update({
        where: { id: ctx.token.id },
        data: { usedAt: new Date() },
      });
    });

    return res.render("monthly_vote", {
      title: "Votação do mês",
      error: null,
      success: true,
      candidates: ctx.candidates,
      voter: ctx.voter,
      monthLabel: ctx.monthLabel,
      token,
    });
  } catch (err) {
    console.error("Erro ao registrar voto mensal:", err);
    return res.render("monthly_vote", {
      title: "Votação do mês",
      error: "Erro ao registrar o voto. Tente novamente.",
      success: false,
      candidates: ctx.candidates,
      voter: ctx.voter,
      monthLabel: ctx.monthLabel,
      token,
    });
  }
});

module.exports = router;
