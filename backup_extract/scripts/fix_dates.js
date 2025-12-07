// scripts/fix_dates.js
// Ajusta todas as peladas somando +1 dia em playedAt

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("🛠 Ajustando datas das peladas (+1 dia)...");

  const matches = await prisma.match.findMany({
    orderBy: { playedAt: "asc" },
  });

  console.log(`📅 Encontradas ${matches.length} peladas.`);

  for (const match of matches) {
    const oldDate = match.playedAt;
    const newDate = new Date(oldDate);
    newDate.setDate(newDate.getDate() + 1);

    await prisma.match.update({
      where: { id: match.id },
      data: { playedAt: newDate },
    });

    console.log(
      `✔ Match ${match.id}: ${oldDate.toISOString().slice(0, 10)} → ${newDate
        .toISOString()
        .slice(0, 10)}`
    );
  }

  console.log("✅ Todas as datas foram ajustadas!");
}

main()
  .catch((err) => {
    console.error("❌ Erro ao ajustar datas:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit();
  });
