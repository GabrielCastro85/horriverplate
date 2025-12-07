require("dotenv").config();
const prisma = require("../utils/db");
const { checkAndUnlock } = require("../utils/achievements");

/**
 * Recalcula e aplica conquistas para todos os jogadores.
 * Uso: npm run achievements:recalc
 */
async function main() {
  const players = await prisma.player.findMany({ select: { id: true, name: true } });
  let unlocked = 0;

  for (const p of players) {
    await checkAndUnlock(p.id);
    unlocked += 1;
  }

  console.log(`Conquistas verificadas para ${unlocked} jogadores.`);
}

main()
  .catch((err) => {
    console.error("Erro ao recalcular conquistas:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
