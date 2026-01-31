// routes/matches.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// Página pública da pelada: qualquer um pode ver
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(404).render("404", { title: "404" });
    }

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: true },
          // 🔽 AGORA EM ORDEM ALFABÉTICA PELO NOME DO JOGADOR
          orderBy: {
            player: { name: "asc" },
          },
        },
      },
    });

    if (!match) {
      return res.status(404).render("404", { title: "404" });
    }

    res.render("public_match", {
      title: `Pelada em ${new Date(match.playedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
      match,
    });
  } catch (err) {
    console.error("Erro em GET /matches/:id:", err);
    res.status(500).send("Erro ao carregar estatísticas da pelada");
  }
});

module.exports = router;
