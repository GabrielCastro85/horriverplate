require("dotenv").config();
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");

/**
 * Recalcula overall (0-100) para todos os jogadores com base nas stats
 * acumuladas e grava histórico em OverallHistory.
 *
 * Uso: node scripts/recalculateOverall.js
 */
async function main() {
  const players = await prisma.player.findMany({
    include: {
      stats: {
        include: { match: true },
      },
    },
  });

  const entries = players.map((p) => {
    let goals = 0;
    let assists = 0;
    let matches = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    for (const s of p.stats || []) {
      goals += s.goals || 0;
      assists += s.assists || 0;
      if (s.present) matches++;
      if (s.rating != null) {
        ratingSum += s.rating;
        ratingCount++;
      }
    }

    const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    return { player: p, goals, assists, matches, rating };
  });

  const { computed, maxGoals, maxAssists, maxMatches } = computeOverallFromEntries(entries);

  const ops = computed.map((row) =>
    prisma.overallHistory.create({
      data: {
        playerId: row.player.id,
        overall: row.overall,
        window: "all-time",
        source: {
          maxGoals,
          maxAssists,
          maxMatches,
          weights: row._calc?.weights || null,
        },
      },
    })
  );

  await prisma.$transaction(ops);

  console.log(`Overall gravado para ${ops.length} jogadores.`);
}

main()
  .catch((err) => {
    console.error("Erro ao recalcular overall:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
