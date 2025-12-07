const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

function computeOverall(ratings) {
  if (!ratings || !ratings.length) return 0;
  // usa as 5 mais recentes
  const slice = ratings.slice(0, 5);
  const avg = slice.reduce((s, n) => s + n, 0) / slice.length;
  // converte para escala 0-100 para exibir como OVR
  return Math.round(avg * 10);
}

// Página de elenco (pública)
router.get("/", async (req, res) => {
  try {
    // Busca jogadores sem OVR (público)
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    res.render("elenco", {
      title: "Elenco",
      activePage: "elenco", // deixa o menu "Elenco" marcado no header
      players,
    });
  } catch (err) {
    console.error("Erro ao carregar elenco:", err);
    res.status(500).send("Erro ao carregar a página de elenco.");
  }
});

module.exports = router;
