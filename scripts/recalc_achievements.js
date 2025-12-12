const { PrismaClient } = require("../node_modules/@prisma/client");
const { evaluateAchievementsForPlayer } = require("../utils/achievements");

const prisma = new PrismaClient();

(async () => {
  try {
    const players = await prisma.player.findMany({ select: { id: true, name: true } });
    let total = 0;
    for (const p of players) {
      await evaluateAchievementsForPlayer(p.id);
      total++;
      if (total % 10 === 0) console.log("recalc", total);
    }
    console.log("done players:", total);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
