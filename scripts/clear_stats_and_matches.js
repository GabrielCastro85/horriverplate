// scripts/clear_stats_and_matches.js
const prisma = require("../utils/db");

async function main() {
  console.log("🚨 Limpando dados de peladas e estatísticas (mantendo jogadores)...");

  // Ordem importa por causa das FKs
  console.log("Apagando craques da semana...");
  await prisma.weeklyAward.deleteMany({});

  console.log("Apagando craques do mês...");
  await prisma.monthlyAward.deleteMany({});

  console.log("Apagando estatísticas de jogadores (PlayerStat)...");
  await prisma.playerStat.deleteMany({});

  console.log("Apagando peladas (Match)...");
  await prisma.match.deleteMany({});

  console.log("✅ Pronto! Jogadores foram mantidos, o resto foi zerado.");
}

main()
  .catch((err) => {
    console.error("❌ Erro ao limpar dados:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
