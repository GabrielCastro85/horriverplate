const express = require("express");
const crypto = require("crypto");
const prisma = require("../../utils/db");
const { uploadWeeklyTeamPhoto, processUploadedImage } = require("../../utils/upload");
const { deleteCache } = require("../../utils/page_cache");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Monthly vote data computation (used by /monthly-vote-session)
// ==============================

const MONTHLY_VOTE_WEIGHTS = {
  goals: 0.3,
  assists: 0.2,
  rating: 0.5,
};
const MONTHLY_VOTE_MIN_MATCHES = 2;

function getMonthRange(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1, 3, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 3, 0, 0, 0));
  return { start, end };
}

async function computeMonthlyVoteData(month, year) {
  const { start, end } = getMonthRange(year, month);
  const stats = await prisma.playerStat.findMany({
    where: {
      present: true,
      match: { playedAt: { gte: start, lt: end } },
    },
    include: { player: true },
  });

  const agg = new Map();
  stats.forEach((stat) => {
    if (!agg.has(stat.playerId)) {
      agg.set(stat.playerId, {
        player: stat.player,
        matches: 0,
        goals: 0,
        assists: 0,
        ratingSum: 0,
        ratingCount: 0,
        photos: 0,
      });
    }
    const row = agg.get(stat.playerId);
    row.matches += 1;
    row.goals += stat.goals || 0;
    row.assists += stat.assists || 0;
    row.photos += stat.appearedInPhoto ? 1 : 0;
    if (stat.rating != null) {
      row.ratingSum += stat.rating;
      row.ratingCount += 1;
    }
  });

  const allRows = Array.from(agg.values()).map((row) => {
    const avgGoals = row.matches ? row.goals / row.matches : 0;
    const avgAssists = row.matches ? row.assists / row.matches : 0;
    const avgRating = row.ratingCount ? row.ratingSum / row.ratingCount : 0;
    const score =
      avgGoals * MONTHLY_VOTE_WEIGHTS.goals +
      avgAssists * MONTHLY_VOTE_WEIGHTS.assists +
      avgRating * MONTHLY_VOTE_WEIGHTS.rating;
    return {
      player: row.player,
      matches: row.matches,
      goals: row.goals,
      assists: row.assists,
      photos: row.photos,
      avgGoals,
      avgAssists,
      avgRating,
      score,
    };
  });

  const eligibleVoters = allRows.map((r) => r.player.id);
  const candidates = allRows
    .filter((r) => r.matches >= MONTHLY_VOTE_MIN_MATCHES)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((r) => ({
      id: r.player.id,
      name: r.player.name,
      nickname: r.player.nickname || null,
      photoUrl: r.player.photoUrl || null,
      matches: r.matches,
      goals: r.goals,
      assists: r.assists,
      photos: r.photos,
      avgGoals: Number(r.avgGoals.toFixed(2)),
      avgAssists: Number(r.avgAssists.toFixed(2)),
      avgRating: Number(r.avgRating.toFixed(2)),
      score: Number(r.score.toFixed(4)),
    }));

  return { candidates, eligibleVoters };
}

// ==============================
// Destaques — Craque + Time da semana
// ==============================

router.post(
  "/weekly-awards",
  requireAdmin,
  uploadWeeklyTeamPhoto.single("teamPhoto"),
  async (req, res) => {
    try {
      const { weekStart, bestPlayerId, winningMatchId } = req.body;

      if (!weekStart) {
        return res.redirect("/admin");
      }

      const weekDate = new Date(weekStart);
      const rawBest = bestPlayerId;
      const rawMatch = winningMatchId;
      const bestId = rawBest && rawBest !== "" ? Number(rawBest) : null;
      const matchId = rawMatch && rawMatch !== "" ? Number(rawMatch) : null;

      let teamPhotoUrl = null;
      if (req.file) {
        const newFilename = await processUploadedImage(req.file.path, "weekly");
        teamPhotoUrl = `/uploads/weekly/${newFilename}`;
      }

      const existing = await prisma.weeklyAward.findFirst({
        where: { weekStart: weekDate },
      });

      if (existing) {
        const updateData = {
          weekStart: weekDate,
        };

        if (teamPhotoUrl) {
          updateData.teamPhotoUrl = teamPhotoUrl;
        }

        if (typeof rawBest !== "undefined") {
          if (bestId) {
            updateData.bestPlayer = { connect: { id: bestId } };
          } else {
            updateData.bestPlayer = { disconnect: true };
          }
        }

        if (typeof rawMatch !== "undefined") {
          if (matchId) {
            updateData.winningMatch = { connect: { id: matchId } };
          } else {
            updateData.winningMatch = { disconnect: true };
          }
        }

        await prisma.weeklyAward.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        const createData = {
          weekStart: weekDate,
          teamPhotoUrl,
        };

        if (bestId) {
          createData.bestPlayer = { connect: { id: bestId } };
        }

        if (matchId) {
          createData.winningMatch = { connect: { id: matchId } };
        }

        await prisma.weeklyAward.create({
          data: createData,
        });
      }

      deleteCache("home");
      res.redirect("/admin");
    } catch (err) {
      console.error("Erro ao salvar destaque da semana:", err);
      res.redirect("/admin");
    }
  }
);

router.post("/weekly-awards/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    await prisma.weeklyAward.delete({
      where: { id },
    });

    deleteCache("home");
    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir destaque da semana:", err);
    res.redirect("/admin");
  }
});

// ==============================
// Craque do mês
// ==============================

router.post("/monthly-awards", requireAdmin, async (req, res) => {
  try {
    const { month, year, craqueId } = req.body;

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const playerId = craqueId && craqueId !== "" ? Number(craqueId) : null;

    if (!m || !y) {
      return res.redirect("/admin");
    }

    const existing = await prisma.monthlyAward.findFirst({
      where: { month: m, year: y },
    });

    if (existing) {
      const updateData = {
        month: m,
        year: y,
      };

      if (typeof craqueId !== "undefined") {
        if (playerId) {
          updateData.craque = { connect: { id: playerId } };
        } else {
          updateData.craque = { disconnect: true };
        }
      }

      await prisma.monthlyAward.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      const createData = {
        month: m,
        year: y,
      };

      if (playerId) {
        createData.craque = { connect: { id: playerId } };
      }

      await prisma.monthlyAward.create({
        data: createData,
      });
    }

    deleteCache("home");
    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao salvar craque do mês:", err);
    res.redirect("/admin");
  }
});

// ==============================
// Votação do mês — criar sessão
// ==============================

router.post("/monthly-vote-session", requireAdmin, async (req, res) => {
  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);

    if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
      return res.redirect("/admin/monthly-vote?monthlyVoteError=invalidDate");
    }

    const { candidates, eligibleVoters } = await computeMonthlyVoteData(month, year);

    if (!eligibleVoters.length) {
      return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteError=noVoters`);
    }
    if (!candidates.length) {
      return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteError=noCandidates`);
    }

    const uniqueVoters = Array.from(new Set(eligibleVoters));

    await prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyVoteSession.findUnique({
        where: { month_year: { month, year } },
      });

      if (existing) {
        const tokens = await tx.monthlyVoteToken.findMany({
          where: { sessionId: existing.id },
          select: { id: true },
        });
        const tokenIds = tokens.map((t) => t.id);
        if (tokenIds.length) {
          await tx.monthlyVoteBallot.deleteMany({
            where: { tokenId: { in: tokenIds } },
          });
          await tx.monthlyVoteToken.deleteMany({
            where: { id: { in: tokenIds } },
          });
        }
      }

      const session = existing
        ? await tx.monthlyVoteSession.update({
            where: { month_year: { month, year } },
            data: {
              candidates,
              createdByAdminId: req.admin?.id ?? null,
              createdAt: new Date(),
              expiresAt: null,
            },
          })
        : await tx.monthlyVoteSession.create({
            data: {
              month,
              year,
              candidates,
              createdByAdminId: req.admin?.id ?? null,
            },
          });

      const tokensData = uniqueVoters.map((playerId) => ({
        token: crypto.randomBytes(16).toString("hex"),
        sessionId: session.id,
        playerId,
      }));

      if (tokensData.length) {
        await tx.monthlyVoteToken.createMany({ data: tokensData });
      }
    });

    return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteCreated=1`);
  } catch (err) {
    console.error("Erro ao gerar votação do mês:", err);
    return res.redirect("/admin/monthly-vote?monthlyVoteError=server");
  }
});

// ==============================
// Excluir craque do mês
// ==============================

router.post("/monthly-awards/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    await prisma.monthlyAward.delete({
      where: { id },
    });

    deleteCache("home");
    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir craque do mês:", err);
    res.redirect("/admin");
  }
});

// ==============================
// Premiação da temporada (SeasonAward)
// ==============================

router.get("/premiacao", requireAdmin, async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    const awards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    const awardsByYear = awards.reduce((acc, award) => {
      if (!acc[award.year]) acc[award.year] = [];
      acc[award.year].push(award);
      return acc;
    }, {});

    res.render("admin_awards", {
      title: "Premiação da temporada",
      players,
      awardsByYear,
    });
  } catch (err) {
    console.error("Erro ao carregar tela de premiação:", err);
    res.status(500).send("Erro ao carregar premiação da temporada.");
  }
});

router.post("/season-awards", requireAdmin, async (req, res) => {
  try {
    const { year, category, playerId } = req.body;

    const y = parseInt(year, 10);
    const cat = category ? String(category) : null;
    const pId = playerId && playerId !== "" ? Number(playerId) : null;

    if (!y || !cat) {
      return res.redirect("/admin/premiacao");
    }

    const existing = await prisma.seasonAward.findFirst({
      where: {
        year: y,
        category: cat,
      },
    });

    if (existing) {
      await prisma.seasonAward.update({
        where: { id: existing.id },
        data: {
          playerId: pId,
        },
      });
    } else {
      await prisma.seasonAward.create({
        data: {
          year: y,
          category: cat,
          playerId: pId,
        },
      });
    }

    res.redirect("/admin/premiacao");
  } catch (err) {
    console.error("Erro ao salvar prêmio de temporada:", err);
    res.redirect("/admin/premiacao");
  }
});

router.post("/season-awards/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin/premiacao");
    }

    await prisma.seasonAward.delete({
      where: { id },
    });

    res.redirect("/admin/premiacao");
  } catch (err) {
    console.error("Erro ao excluir prêmio de temporada:", err);
    res.redirect("/admin/premiacao");
  }
});

module.exports = router;
