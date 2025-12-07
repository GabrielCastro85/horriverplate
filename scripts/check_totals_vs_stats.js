// scripts/check_totals_vs_stats.js
// Compara os totais salvos no Player (totalGoals, totalAssists, etc.)
// com os valores recalculados a partir da tabela PlayerStat.
require("dotenv").config();
const prisma = require("../utils/db");

async function recomputeFromStats(playerId) {
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

  const avgRating = ratingCount ? ratingSum / ratingCount : 0;

  return { goals, assists, matches, photos, avgRating };
}

async function main() {
  const players = await prisma.player.findMany({
    select: {
      id: true,
      name: true,
      nickname: true,
      totalGoals: true,
      totalAssists: true,
      totalMatches: true,
      totalPhotos: true,
      totalRating: true,
    },
    orderBy: { name: "asc" },
  });

  let diffs = [];

  for (const p of players) {
    const calc = await recomputeFromStats(p.id);
    const diff = {
      id: p.id,
      name: p.name,
      nickname: p.nickname,
      db: {
        goals: p.totalGoals,
        assists: p.totalAssists,
        matches: p.totalMatches,
        photos: p.totalPhotos,
        rating: Number(p.totalRating || 0),
      },
      calc,
    };

    const hasDiff =
      diff.db.goals !== calc.goals ||
      diff.db.assists !== calc.assists ||
      diff.db.matches !== calc.matches ||
      diff.db.photos !== calc.photos ||
      Math.abs(diff.db.rating - calc.avgRating) > 0.001;

    if (hasDiff) {
      diffs.push(diff);
    }
  }

  if (!diffs.length) {
    console.log("Todos os jogadores estao alinhados com PlayerStat.");
    return;
  }

  console.log("Encontrados jogadores com divergencia (db vs calculado):");
  diffs.forEach((d) => {
    const label = d.nickname ? `${d.name} (${d.nickname})` : d.name;
    console.log(`\n#${d.id} - ${label}`);
    console.log(
      `  Gols: ${d.db.goals} -> ${d.calc.goals} | Assist: ${d.db.assists} -> ${d.calc.assists}`
    );
    console.log(
      `  Jogos: ${d.db.matches} -> ${d.calc.matches} | Fotos: ${d.db.photos} -> ${d.calc.photos}`
    );
    console.log(
      `  Nota: ${d.db.rating.toFixed(2)} -> ${d.calc.avgRating.toFixed(2)}`
    );
  });
}

main()
  .catch((err) => {
    console.error("Erro ao checar divergencias:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
