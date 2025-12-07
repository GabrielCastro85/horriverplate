// routes/awards.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");

// helper pra transformar enum em label bonitinha
function categoryLabel(category) {
  switch (category) {
    case "ARTILHEIRO":
      return "Artilheiro";
    case "ASSISTENTE":
      return "Assistente";
    case "MELHOR_JOGADOR":
      return "Melhor jogador";
    case "MELHOR_GOLEIRO":
      return "Melhor goleiro";
    case "MELHOR_ZAGUEIRO":
      return "Melhor zagueiro";
    case "MELHOR_MEIA":
      return "Melhor meia";
    case "MELHOR_ATACANTE":
      return "Melhor atacante";
    case "REI_DAS_FOTOS":
      return "Rei das fotos";
    default:
      return category;
  }
}

router.get("/", async (req, res) => {
  try {
    // Busca todas as premiações cadastradas
    const awards = await prisma.seasonAward.findMany({
      include: {
        player: true,
      },
      orderBy: [
        { year: "desc" },
        { category: "asc" },
      ],
    });

    // Se ainda não tiver nada cadastrado
    if (!awards || awards.length === 0) {
      return res.render("awards", {
        title: "Premiação",
        awardsByYear: {},
        currentYear: null,
        categoryLabel,
      });
    }

    // Agrupa por ano
    const awardsByYear = {};
    for (const award of awards) {
      if (!awardsByYear[award.year]) {
        awardsByYear[award.year] = [];
      }
      awardsByYear[award.year].push(award);
    }

    // Descobre o ano mais recente
    const years = Object.keys(awardsByYear)
      .map(Number)
      .sort((a, b) => b - a);
    const currentYear = years[0];

    res.render("awards", {
      title: "Premiação",
      awardsByYear,
      currentYear,
      categoryLabel,
    });
  } catch (err) {
    console.error("Erro ao carregar /premiacao:", err);
    res.status(500).send("Erro ao carregar premiação");
  }
});

module.exports = router;
