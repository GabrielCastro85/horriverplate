const prisma = require("./db");
const { computeOverallFromEntries } = require("./overall");

const MATCH_WINDOW = 10;

/**
 * Recalcula o overall para todos os jogadores com base nas estatísticas
 * das últimas X partidas e salva o resultado na tabela OverallHistory.
 * @returns {Promise<{count: number}>} - Retorna o número de jogadores atualizados.
 */
async function recalculateOverallForAllPlayers() {
  console.log(`Buscando as últimas ${MATCH_WINDOW} peladas...`);

  const lastMatches = await prisma.match.findMany({
    orderBy: { playedAt: "desc" },
    take: MATCH_WINDOW,
    select: { id: true },
  });

  if (lastMatches.length === 0) {
    console.log("Nenhuma pelada encontrada para calcular o overall.");
    return { count: 0 };
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
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.present) matches++;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount++;
        }
      }
      
      if (matches === 0) {
        return null;
      }
      
      const rating = ratingCount > 0 ? ratingSum / ratingCount : 0;

      return { player: p, goals, assists, matches, rating };
    })
    .filter(Boolean);

  if (entries.length === 0) {
    console.log("Nenhum jogador com stats nas últimas peladas para calcular.");
    return { count: 0 };
  }

  console.log(`Calculando overall para ${entries.length} jogadores...`);

  const { computed, maxGoals, maxAssists, maxMatches } = computeOverallFromEntries(entries);
  
  // Limpa o histórico anterior para a mesma janela para evitar duplicatas
  await prisma.overallHistory.deleteMany({
    where: {
      window: `last-${lastMatches.length}-matches`,
    },
  });

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
  return { count: ops.length };
}

module.exports = {
  recalculateOverallForAllPlayers,
};
