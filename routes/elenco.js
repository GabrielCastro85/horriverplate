const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// Página de elenco (pública)
router.get("/", async (req, res) => {
  try {
    // Busca todos os jogadores ordenados por nome
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    res.render("elenco", {
      title: "Elenco",
      activePage: "elenco", // deixa o menu "Elenco" marcado no header
      players,              // <<< usado em elenco.ejs
    });
  } catch (err) {
    console.error("Erro ao carregar elenco:", err);
    res.status(500).send("Erro ao carregar a página de elenco.");
  }
});

module.exports = router;
