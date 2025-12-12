const { PrismaClient } = require("../node_modules/@prisma/client");
const { evaluateAchievementsForPlayer } = require("../utils/achievements");

const prisma = new PrismaClient();
const id = Number(process.argv[2] || 0);

if (!id) {
  console.error("Informe o playerId. Ex: node scripts/recalc_player.js 16");
  process.exit(1);
}

(async () => {
  try {
    await evaluateAchievementsForPlayer(id);
    console.log("recalc ok para player", id);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
