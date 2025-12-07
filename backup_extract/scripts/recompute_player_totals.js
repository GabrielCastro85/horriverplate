// scripts/recompute_player_totals.js
// Recalcula totais (gols, assistências, partidas, fotos, média de notas) para TODOS os jogadores
// com base na tabela PlayerStat. Use quando houver divergência entre planilha e site.
require("dotenv").config();
const prisma = require("../utils/db");

async function recomputeForPlayer(playerId) {
  const stats = await prisma.playerStat.findMany({
    where: { playerId },
  });

  let goals = 0;
  let assists = 0;
  let matches = 0;
  let photos = 0;
  let ratingSum = 0;
  let ratingCount = 0;

  for (const s of stats) {
    goals += s.goals || 0;
    assists += s.assists || 0;
    if (s.present) matches++;
    if (s.appearedInPhoto) photos++;
    if (s.rating != null) {
      ratingSum += s.rating;
      ratingCount++;
    }
  }

  const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

  await prisma.player.update({
    where: { id: playerId },
    data: {
      totalGoals: goals,
      totalAssists: assists,
      totalMatches: matches,
      totalPhotos: photos,
      totalRating: avgRating,
    },
  });

  return { goals, assists, matches, photos, avgRating };
}

async function main() {
  const players = await prisma.player.findMany({ select: { id: true, name: true } });
  console.log(`Recalculando totais para ${players.length} jogadores...`);

  for (const p of players) {
    const totals = await recomputeForPlayer(p.id);
    console.log(
      `OK ${p.name}: gols=${totals.goals}, assist=${totals.assists}, jogos=${totals.matches}, fotos=${totals.photos}, nota=${totals.avgRating.toFixed(
        2
      )}`
    );
  }

  console.log("Concluído.");
}

main()
  .catch((err) => {
    console.error("Erro ao recalcular totais:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
