require("dotenv").config();
const prisma = require("../utils/db");
const { computeOverallFromEntries } = require("../utils/overall");

const MATCH_WINDOW = 10;

/**
 * Recalcula overall (0-100) para todos os jogadores com base nas stats
 * das últimas X peladas e grava histórico em OverallHistory.
 *
 * Uso: node scripts/recalculateOverall.js
 */
async function main() {
  console.log(`Buscando as últimas ${MATCH_WINDOW} peladas...`);

  const lastMatches = await prisma.match.findMany({
    orderBy: { playedAt: "desc" },
    take: MATCH_WINDOW,
    select: { id: true },
  });

  if (lastMatches.length === 0) {
    console.log("Nenhuma pelada encontrada para calcular o overall.");
    return;
  }

  const lastMatchIds = lastMatches.map((m) => m.id);

  console.log(`Buscando jogadores e suas stats nas últimas ${lastMatches.length} peladas...`);

  const players = await prisma.player.findMany({
    include: {
      stats: {
        where: {
          matchId: { in: lastMatchIds },
        },
        include: { match: true },
      },
    },
  });

  const entries = players
    .map((p) => {
      let goals = 0;
      let assists = 0;
      let matches = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      for (const s of p.stats || []) {
        if (!s.present) continue;

        goals += s.goals || 0;
        assists += s.assists || 0;
        matches++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      }

      // Só considera jogadores que participaram de pelo menos uma das últimas X peladas
      if (matches === 0) {
        return null;
      }
      
      const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

      return { player: p, goals, assists, matches, rating };
    })
    .filter(Boolean); // Remove os jogadores nulos (que não participaram)

  if (entries.length === 0) {
    console.log("Nenhum jogador com stats nas últimas peladas para calcular.");
    return;
  }

  console.log(`Calculando overall para ${entries.length} jogadores...`);

  const { computed, maxGoals, maxAssists, maxMatches } = computeOverallFromEntries(entries);

  const ops = computed.map((row) =>
    prisma.overallHistory.create({
      data: {
        playerId: row.player.id,
        overall: row.overall,
        window: `last-${lastMatches.length}-matches`,
        source: {
          stats: {
            goals: row.goals,
            assists: row.assists,
            matches: row.matches,
            rating: row.rating,
          },
          maxValues: {
            maxGoals,
            maxAssists,
            maxMatches,
          },
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
