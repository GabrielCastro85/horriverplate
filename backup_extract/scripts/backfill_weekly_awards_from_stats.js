// scripts/backfill_weekly_awards_from_stats.js
const prisma = require("../utils/db");

function getWeekStart(date) {
  // Começo da semana na segunda-feira
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = dom, 1 = seg, ...
  const diff = (day + 6) % 7; // transforma segunda em 0
  d.setDate(d.getDate() - diff);
  return d;
}

async function main() {
  console.log("🔎 Buscando stats com nota...");
  const stats = await prisma.playerStat.findMany({
    where: {
      rating: {
        not: null,
      },
    },
    include: {
      match: true,
      player: true,
    },
  });

  console.log(`Total de registros com nota: ${stats.length}`);

  const weeksMap = new Map();

  // Agrupa por semana e guarda o melhor da semana
  for (const s of stats) {
    if (!s.match || !s.match.playedAt) continue;

    const weekStartDate = getWeekStart(s.match.playedAt);
    const key = weekStartDate.toISOString().slice(0, 10); // "YYYY-MM-DD"

    const currentBest = weeksMap.get(key);

    if (!currentBest) {
      weeksMap.set(key, { ...s, weekStartDate });
    } else {
      const currScore = currentBest.rating || 0;
      const newScore = s.rating || 0;

      const currGA =
        (currentBest.goals || 0) + (currentBest.assists || 0);
      const newGA = (s.goals || 0) + (s.assists || 0);

      // 1º critério: maior nota
      // 2º critério: maior (gols + assistências)
      if (
        newScore > currScore ||
        (newScore === currScore && newGA > currGA)
      ) {
        weeksMap.set(key, { ...s, weekStartDate });
      }
    }
  }

  console.log(`📆 Semanas encontradas: ${weeksMap.size}`);

  let created = 0;
  let skipped = 0;

  for (const [key, stat] of weeksMap.entries()) {
    const weekStartDate = stat.weekStartDate;

    // Verifica se já existe craque pra essa semana
    const existing = await prisma.weeklyAward.findFirst({
      where: {
        weekStart: weekStartDate,
      },
    });

    if (existing) {
      console.log(
        `⏭ Semana ${key}: já existe (id=${existing.id}), pulando.`
      );
      skipped++;
      continue;
    }

    // Cria novo WeeklyAward
    const wa = await prisma.weeklyAward.create({
      data: {
        weekStart: weekStartDate,
        bestPlayerId: stat.playerId,
        winningMatchId: stat.matchId,
        // teamPhotoUrl fica null mesmo, aqui é só histórico
      },
    });

    console.log(
      `✅ Semana ${key}: craque = ${stat.player.name} (nota ${stat.rating.toFixed(
        2
      )}), award id=${wa.id}`
    );
    created++;
  }

  console.log("-----");
  console.log(`Craques criados: ${created}`);
  console.log(`Semanas puladas (já tinham craque): ${skipped}`);
}

main()
  .catch((err) => {
    console.error("Erro ao gerar craques da semana:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
