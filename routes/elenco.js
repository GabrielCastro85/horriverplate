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
    const query = (req.query.q || "").toString().trim();
    const position = (req.query.position || "all").toString().trim().toLowerCase();
    const positionMap = {
      goleiro: "Goleiro",
      zagueiro: "Zagueiro",
      meia: "Meia",
      atacante: "Atacante",
    };

    const where = {};
    if (position && position !== "all") {
      where.position = positionMap[position] || position;
    }
    if (query) {
      where.OR = [
        { name: { contains: query, mode: "insensitive" } },
        { nickname: { contains: query, mode: "insensitive" } },
      ];
    }

    const players = await prisma.player.findMany({
      where,
      orderBy: { name: "asc" },
    });

    res.render("elenco", {
      title: "Elenco",
      activePage: "elenco",
      players,
      query,
      position,
    });
  } catch (err) {
    console.error("Erro ao carregar elenco:", err);
    res.status(500).send("Erro ao carregar a pagina de elenco.");
  }
});
module.exports = router;

