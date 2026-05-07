const express = require("express");
const prisma = require("../../utils/db");
const { uploadPlayerPhoto, processUploadedImage } = require("../../utils/upload");
const { deleteCache } = require("../../utils/page_cache");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Jogadores - CRUD
// ==============================

router.post(
  "/players",
  requireAdmin,
  uploadPlayerPhoto.single("photo"),
  async (req, res) => {
    try {
      const { name, nickname, position, whatsapp, hallStatus, hallReasonText, baseOverall, overrideOverall } = req.body;

      if (!name || !position) {
        return res.redirect("/admin");
      }

      let formattedWhatsapp = null;
      if (whatsapp) {
        const digitsOnly = whatsapp.replace(/\D/g, '');
        if (digitsOnly) {
          formattedWhatsapp = `55${digitsOnly}`;
        }
      }

      let photoUrl = null;
      if (req.file) {
        const newFilename = await processUploadedImage(req.file.path, "player");
        photoUrl = `/uploads/players/${newFilename}`;
      }

      const baseOv = Math.round(Number(baseOverall));
      const manualOvRaw = Number(overrideOverall);
      const manualOv = Number.isFinite(manualOvRaw) ? Math.round(manualOvRaw) : null;

      await prisma.player.create({
        data: {
          name,
          nickname: nickname || null,
          position,
          whatsapp: formattedWhatsapp,
          photoUrl,
          financeActive: true,
          isMonthlyMember: true,
          baseOverall: Number.isFinite(baseOv) ? baseOv : 60,
          overallDynamic: manualOv,
          totalGoals: 0,
          totalAssists: 0,
          totalMatches: 0,
          totalPhotos: 0,
          totalRating: 0,
        },
      });

      deleteCache("elenco");
      res.redirect("/admin");
    } catch (err) {
      console.error("Erro ao adicionar jogador:", err);
      res.redirect("/admin");
    }
  }
);

router.get("/players/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin#jogadores");
    }

    const player = await prisma.player.findUnique({
      where: { id },
    });

    if (!player) {
      return res.redirect("/admin#jogadores");
    }

    res.render("admin_player_edit", {
      title: `Editar ${player.name}`,
      player,
    });
  } catch (err) {
    console.error("Erro ao carregar página de edição de jogador:", err);
    res.redirect("/admin#jogadores");
  }
});

router.post(
  "/players/:id/edit",
  requireAdmin,
  uploadPlayerPhoto.single("photo"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { name, nickname, position, whatsapp, hallStatus, hallReasonText, baseOverall, overrideOverall } = req.body;

      if (!name || !position || Number.isNaN(id)) {
        return res.redirect("/admin");
      }

      let formattedWhatsapp = null;
      if (whatsapp) {
        const digitsOnly = whatsapp.replace(/\D/g, '');
        if (digitsOnly) {
          formattedWhatsapp = `55${digitsOnly}`;
        }
      }

      let photoUrl = null;
      if (req.file) {
        const newFilename = await processUploadedImage(req.file.path, "player");
        photoUrl = `/uploads/players/${newFilename}`;
      }

      const data = {
        name,
        nickname: nickname || null,
        position,
        whatsapp: formattedWhatsapp,
      };

      const baseOv = Math.round(Number(baseOverall));
      if (Number.isFinite(baseOv)) {
        data.baseOverall = baseOv;
      }

      const manualOvRaw = Number(overrideOverall);
      if (Number.isFinite(manualOvRaw)) {
        data.overallDynamic = Math.round(manualOvRaw);
      } else {
        data.overallDynamic = null;
      }

      const status = hallStatus || "active";
      if (status === "retired") {
        data.isHallOfFame = false;
        data.hallReason = "Aposentado";
      } else {
        data.isHallOfFame = false;
        data.hallReason = hallReasonText || null;
      }

      if (photoUrl) {
        data.photoUrl = photoUrl;
      }

      await prisma.player.update({
        where: { id },
        data,
      });

      deleteCache("elenco");
      res.redirect("/admin#jogadores");
    } catch (err) {
      console.error("Erro ao editar jogador:", err);
      res.redirect("/admin");
    }
  }
);

router.post("/players/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin#jogadores");

    const player = await prisma.player.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!player) return res.redirect("/admin#jogadores");

    await prisma.$transaction(async (tx) => {
      const [playerVoteLinks, playerVoteTokens, playerMonthlyVoteTokens] = await Promise.all([
        tx.voteLink.findMany({
          where: { playerId: id },
          select: { id: true },
        }),
        tx.voteToken.findMany({
          where: { playerId: id },
          select: { id: true },
        }),
        tx.monthlyVoteToken.findMany({
          where: { playerId: id },
          select: { id: true },
        }),
      ]);

      const voteLinkIds = playerVoteLinks.map((row) => row.id);
      const voteTokenIds = playerVoteTokens.map((row) => row.id);
      const monthlyVoteTokenIds = playerMonthlyVoteTokens.map((row) => row.id);

      const playerBallots = voteTokenIds.length
        ? await tx.voteBallot.findMany({
            where: { voteTokenId: { in: voteTokenIds } },
            select: { id: true },
          })
        : [];
      const playerVoteBallotIds = playerBallots.map((row) => row.id);

      if (voteLinkIds.length) {
        await tx.voteChoice.deleteMany({
          where: { voteLinkId: { in: voteLinkIds } },
        });
      }

      await tx.voteChoice.deleteMany({
        where: { targetPlayerId: id },
      });

      if (playerVoteBallotIds.length) {
        await tx.voteRanking.deleteMany({
          where: { voteBallotId: { in: playerVoteBallotIds } },
        });
        await tx.voteRating.deleteMany({
          where: { voteBallotId: { in: playerVoteBallotIds } },
        });
      }

      await tx.voteRanking.deleteMany({
        where: { playerId: id },
      });
      await tx.voteRating.deleteMany({
        where: { playerId: id },
      });

      await tx.voteBallot.updateMany({
        where: { bestOverallPlayerId: id },
        data: { bestOverallPlayerId: null },
      });

      if (voteTokenIds.length) {
        await tx.voteBallot.deleteMany({
          where: { voteTokenId: { in: voteTokenIds } },
        });
      }
      await tx.voteToken.deleteMany({
        where: { playerId: id },
      });

      if (monthlyVoteTokenIds.length) {
        await tx.monthlyVoteBallot.deleteMany({
          where: { tokenId: { in: monthlyVoteTokenIds } },
        });
      }
      await tx.monthlyVoteBallot.deleteMany({
        where: { candidateId: id },
      });
      await tx.monthlyVoteToken.deleteMany({
        where: { playerId: id },
      });

      await tx.weeklyAward.updateMany({
        where: { bestPlayerId: id },
        data: { bestPlayerId: null },
      });
      await tx.monthlyAward.updateMany({
        where: { craqueId: id },
        data: { craqueId: null },
      });

      await tx.seasonAward.deleteMany({
        where: { playerId: id },
      });
      await tx.playerAchievement.deleteMany({
        where: { playerId: id },
      });
      await tx.overallHistory.deleteMany({
        where: { playerId: id },
      });
      await tx.playerStat.deleteMany({
        where: { playerId: id },
      });

      await tx.voteLink.deleteMany({
        where: { playerId: id },
      });

      await tx.player.delete({
        where: { id },
      });
    }, {
      maxWait: 10000,
      timeout: 30000,
    });

    return res.redirect("/admin#jogadores");
  } catch (err) {
    console.error("Erro ao excluir jogador:", err);
    return res.redirect("/admin?error=deletePlayer#jogadores");
  }
});

module.exports = router;
