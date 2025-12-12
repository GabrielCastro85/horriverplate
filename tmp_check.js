const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const id = 7;
    const achs = await prisma.playerAchievement.findMany({
      where: { playerId: id },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });
    console.log('count', achs.length);
    console.log(achs.slice(0,3));
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
