const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const achs = await prisma.achievement.findMany({ orderBy: { id: 'asc' } });
    console.log(achs);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
})();
