const { PrismaClient } = require("../node_modules/@prisma/client");
const prisma = new PrismaClient();

const id = Number(process.argv[2] || 0);
if (!id) {
  console.error("Informe o playerId. Ex: node scripts/check_awards_counts.js 16");
  process.exit(1);
}

(async () => {
  try {
    const weekly = await prisma.weeklyAward.count({ where: { bestPlayerId: id } });
    const monthly = await prisma.monthlyAward.count({ where: { craqueId: id } });
    console.log({ playerId: id, weekly, monthly });
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
