const express = require("express");
const prisma = require("../../utils/db");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Votação do mês (painel separado)
// ==============================
router.get("/monthly-vote", requireAdmin, async (req, res) => {
  try {
    const latestMatch = await prisma.match.findFirst({
      orderBy: { playedAt: "desc" },
    });
    const referenceDate = latestMatch ? new Date(latestMatch.playedAt) : new Date();

    const monthNames = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    ];

    const hasMonthParam = req.query.mvMonth != null;
    const hasYearParam = req.query.mvYear != null;
    let mvMonth = Number(req.query.mvMonth) || referenceDate.getMonth() + 1;
    let mvYear = Number(req.query.mvYear) || referenceDate.getFullYear();

    if (!hasMonthParam && !hasYearParam) {
      const latestSession = await prisma.monthlyVoteSession.findFirst({
        orderBy: { createdAt: "desc" },
      });
      if (latestSession) {
        mvMonth = latestSession.month;
        mvYear = latestSession.year;
      }
    }

    const monthlyVoteSession = await prisma.monthlyVoteSession.findUnique({
      where: { month_year: { month: mvMonth, year: mvYear } },
      include: { tokens: { include: { player: true } } },
    });

    const monthlyVoteTokens = monthlyVoteSession?.tokens
      ? [...monthlyVoteSession.tokens].sort((a, b) => {
          const an = a.player?.name || "";
          const bn = b.player?.name || "";
          return an.localeCompare(bn);
        })
      : [];
    const monthlyVoteCandidates = Array.isArray(monthlyVoteSession?.candidates)
      ? monthlyVoteSession.candidates
      : [];
    const voteBaseUrl = `${req.protocol}://${req.get("host")}`;
    const monthlyVoteBallots = monthlyVoteSession
      ? await prisma.monthlyVoteBallot.findMany({
          where: { token: { sessionId: monthlyVoteSession.id } },
          include: { token: { include: { player: true } }, candidate: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const monthlyVoteCounts = monthlyVoteBallots.reduce((acc, ballot) => {
      const key = ballot.candidateId;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    let monthlyVoteWinner = null;
    if (monthlyVoteCandidates.length) {
      monthlyVoteWinner = [...monthlyVoteCandidates]
        .map((candidate) => ({
          ...candidate,
          votes: monthlyVoteCounts[candidate.id] || 0,
        }))
        .sort((a, b) => {
          if (b.votes !== a.votes) return b.votes - a.votes;
          if (b.score !== a.score) return (b.score || 0) - (a.score || 0);
          return String(a.name || "").localeCompare(String(b.name || ""));
        })[0];
    }

    const now = new Date();
    const monthlyVoteClosed =
      !!monthlyVoteSession?.expiresAt &&
      new Date(monthlyVoteSession.expiresAt).getTime() <= now.getTime();

    const closedSessions = await prisma.monthlyVoteSession.findMany({
      where: { expiresAt: { lt: now } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    const winnersHistory = [];
    for (const session of closedSessions) {
      const ballots = await prisma.monthlyVoteBallot.findMany({
        where: { token: { sessionId: session.id } },
        include: { candidate: true },
      });
      if (!ballots.length) continue;
      const counts = ballots.reduce((acc, ballot) => {
        acc[ballot.candidateId] = (acc[ballot.candidateId] || 0) + 1;
        return acc;
      }, {});
      const winner = ballots
        .map((b) => b.candidate)
        .filter(Boolean)
        .map((candidate) => ({
          candidate,
          votes: counts[candidate.id] || 0,
        }))
        .sort((a, b) => b.votes - a.votes)[0];
      if (!winner) continue;
      winnersHistory.push({
        month: session.month,
        year: session.year,
        name: winner.candidate.name,
        votes: winner.votes,
      });
    }

    res.render("admin_monthly_vote", {
      title: "Votação do mês",
      mvMonth,
      mvYear,
      monthNames,
      monthlyVoteSession,
      monthlyVoteTokens,
      monthlyVoteCandidates,
      monthlyVoteBallots,
      monthlyVoteCounts,
      monthlyVoteWinner,
      monthlyVoteClosed,
      winnersHistory,
      voteBaseUrl,
      monthlyVoteError: req.query.monthlyVoteError || null,
      monthlyVoteCreated: req.query.monthlyVoteCreated === "1",
    });
  } catch (err) {
    console.error("Erro ao carregar votação do mês:", err);
    res.status(500).send("Erro ao carregar votação do mês.");
  }
});

// ==============================
// Encerrar votação do mês
// ==============================
router.post("/monthly-vote/:id/close", requireAdmin, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.redirect("/admin/monthly-vote");

    const session = await prisma.monthlyVoteSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date() },
    });

    const ballots = await prisma.monthlyVoteBallot.findMany({
      where: { token: { sessionId } },
    });
    if (ballots.length) {
      const counts = ballots.reduce((acc, b) => {
        acc[b.candidateId] = (acc[b.candidateId] || 0) + 1;
        return acc;
      }, {});
      const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winnerId) {
        await prisma.monthlyAward.upsert({
          where: { month_year: { month: session.month, year: session.year } },
          update: { craqueId: Number(winnerId) },
          create: { month: session.month, year: session.year, craqueId: Number(winnerId) },
        });
      }
    }

    return res.redirect("/admin/monthly-vote?monthlyVoteClosed=1");
  } catch (err) {
    console.error("Erro ao encerrar votação do mês:", err);
    return res.redirect("/admin/monthly-vote?monthlyVoteError=close");
  }
});

// ==============================
// Excluir votação do mês
// ==============================
router.post("/monthly-vote/:id/delete", requireAdmin, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.redirect("/admin/monthly-vote");

    await prisma.$transaction(async (tx) => {
      await tx.monthlyVoteBallot.deleteMany({
        where: { token: { sessionId } },
      });
      await tx.monthlyVoteToken.deleteMany({ where: { sessionId } });
      await tx.monthlyVoteSession.delete({ where: { id: sessionId } });
    });

    return res.redirect("/admin/monthly-vote");
  } catch (err) {
    console.error("Erro ao excluir votação do mês:", err);
    return res.redirect("/admin/monthly-vote");
  }
});

module.exports = router;
