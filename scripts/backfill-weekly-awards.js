const prisma = require('../utils/db');

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day; // traz para segunda
  d.setDate(d.getDate() + diff);
  return d;
}

async function main() {
  console.log('>> Buscando peladas...');
  const matches = await prisma.match.findMany({
    include: {
      stats: {
        where: { present: true, rating: { not: null } },
        include: { player: true },
      },
    },
    orderBy: { playedAt: 'asc' },
  });

  const byWeek = new Map();
  for (const m of matches) {
    if (!m.playedAt) continue;
    const weekKey = startOfWeekMonday(m.playedAt).toISOString();
    if (!byWeek.has(weekKey)) byWeek.set(weekKey, []);
    byWeek.get(weekKey).push(m);
  }

  let created = 0;
  let skipped = 0;

  for (const [weekIso, weekMatches] of byWeek.entries()) {
    const weekStart = new Date(weekIso);
    const existing = await prisma.weeklyAward.findFirst({ where: { weekStart } });
    if (existing) {
      skipped++;
      continue; // não sobrescreve
    }

    let best = null;
    for (const match of weekMatches) {
      for (const stat of match.stats) {
        if (stat.rating == null) continue;
        const score = Number(stat.rating) || 0;
        const tieBreaker = (stat.goals || 0) + (stat.assists || 0);
        if (!best || score > best.score || (score === best.score && tieBreaker > best.tie)) {
          best = {
            playerId: stat.playerId,
            matchId: match.id,
            score,
            tie: tieBreaker,
          };
        }
      }
    }

    if (!best) {
      skipped++;
      continue;
    }

    await prisma.weeklyAward.create({
      data: {
        weekStart,
        bestPlayerId: best.playerId,
        winningMatchId: best.matchId,
      },
    });
    created++;
  }

  console.log(`Concluído. Criados: ${created}, ignorados (já existiam ou sem nota): ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
