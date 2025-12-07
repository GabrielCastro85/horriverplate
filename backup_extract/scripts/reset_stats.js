const prisma = require("../utils/db");

async function main() {
  console.log("⚠️ Limpando todas as estatísticas e peladas...");

  await prisma.playerStat.deleteMany({});
  await prisma.match.deleteMany({});

  // zerar totais dos jogadores
  await prisma.player.updateMany({
    data: {
      totalGoals: 0,
      totalAssists: 0,
      totalMatches: 0,
      totalPhotos: 0,
      totalRating: 0,
    },
  });

  console.log("✅ Todas as estatísticas, peladas e totais foram limpas.");
}

main()
  .catch((err) => {
    console.error(err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
