const prisma = require("../utils/db");

const ACHIEVEMENTS = [
  {
    slug: "artilheiro-nato",
    name: "Artilheiro Nato",
    description: "Atingir 50 gols na história.",
    category: "Gols",
    icon: "fa-trophy",
    criteria: { type: "total_goals", min: 50 },
  },
  {
    slug: "maestro",
    name: "Maestro",
    description: "Chegar a 40 assistências na história.",
    category: "Assistências",
    icon: "fa-magic",
    criteria: { type: "total_assists", min: 40 },
  },
  {
    slug: "parede-humana",
    name: "Parede Humana",
    description: "Goleiro com média de nota ≥ 8 em 10 jogos.",
    category: "Goleiro",
    icon: "fa-shield",
    criteria: { type: "rating_goalkeeper", minAvg: 8, minMatches: 10 },
  },
  {
    slug: "rei-das-fotos",
    name: "Rei das Fotos",
    description: "Jogador que mais aparece em fotos.",
    category: "Fotos",
    icon: "fa-camera",
    criteria: { type: "photos_top" },
  },
  {
    slug: "craque-da-semana-10",
    name: "Mr. Semana",
    description: "10 vezes craque da semana.",
    category: "Prêmios",
    icon: "fa-star",
    criteria: { type: "weekly_awards", min: 10 },
  },
  {
    slug: "centena-de-jogos",
    name: "100 Jogos",
    description: "Disputou 100 jogos.",
    category: "Marcos",
    icon: "fa-fire",
    criteria: { type: "total_matches", min: 100 },
  },
];

async function main() {
  for (const a of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { slug: a.slug },
      update: a,
      create: a,
    });
  }
  console.log("✅ Conquistas seedadas");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
