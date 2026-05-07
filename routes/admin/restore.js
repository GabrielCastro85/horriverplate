const express = require("express");
const prisma = require("../../utils/db");
const { recalculateOverallForAllPlayers, recalculateHistoricalOverallForAllPlayers } = require("../../utils/ranking");
const { rebuildAchievementsForAllPlayers } = require("../../utils/achievements");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Recalcular totais de TODOS os jogadores
// ==============================
async function handleRecalculateTotals(req, res) {
  try {
    console.log("🔄 Recalculando totais de todos os jogadores...");

    const players = await prisma.player.findMany({
      include: {
        stats: true,
      },
    });

    for (const player of players) {
      const stats = player.stats || [];

      const totalGoals = stats.reduce((sum, s) => sum + (s.goals || 0), 0);
      const totalAssists = stats.reduce((sum, s) => sum + (s.assists || 0), 0);
      const totalMatches = stats.filter((s) => s.present).length;
      const totalPhotos = stats.filter((s) => s.appearedInPhoto).length;

      const rated = stats.filter((s) => s.rating != null);
      const totalRating =
        rated.length > 0
          ? rated.reduce((sum, s) => sum + s.rating, 0) / rated.length
          : 0;

      await prisma.player.update({
        where: { id: player.id },
        data: {
          totalGoals,
          totalAssists,
          totalMatches,
          totalPhotos,
          totalRating,
        },
      });
    }

    console.log("✅ Totais recalculados com sucesso.");
    return res.redirect("/admin?success=totalsRecalculated");
  } catch (err) {
    console.error("Erro ao recalcular totais:", err);
    return res.status(500).send("Erro ao recalcular totais.");
  }
}

router.all("/recalculate-totals", requireAdmin, handleRecalculateTotals);

// ==============================
// Recalcular OVERALL (last 10)
// ==============================
router.post("/recalculate-overall", requireAdmin, async (req, res) => {
  try {
    const { count } = await recalculateOverallForAllPlayers();

    setTimeout(() => {
      res.redirect(`/admin?success=overallRecalculated&count=${count}`);
    }, 500);
  } catch (err) {
    console.error("Erro ao recalcular overall:", err);
    res.redirect("/admin?error=overallError");
  }
});

// ==============================
// Recalcular OVR histórico (todas as peladas)
// ==============================
router.post("/recalculate-overall-historical", requireAdmin, async (req, res) => {
  try {
    const { count } = await recalculateHistoricalOverallForAllPlayers();
    res.redirect(`/admin?success=historicalOvrRecalculated&count=${count}`);
  } catch (err) {
    console.error("Erro ao recalcular OVR histórico:", err);
    res.redirect("/admin?error=historicalOvrError");
  }
});

// ==============================
// Rebuild de conquistas para todos os jogadores
// ==============================
router.post("/rebuild-achievements", requireAdmin, async (req, res) => {
  try {
    await rebuildAchievementsForAllPlayers();
    return res.redirect("/admin?achievementsRebuilt=1");
  } catch (err) {
    console.error("Erro ao recalcular conquistas:", err);
    return res.redirect("/admin?error=achievements");
  }
});

module.exports = router;
