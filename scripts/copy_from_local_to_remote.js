// scripts/copy_from_local_to_remote.js
// Copia TUDO do banco local (velho) para o banco remoto (Render)

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

// Prisma apontando pro banco NOVO (Render) – usa DATABASE_URL
const remote = new PrismaClient();

// Prisma apontando pro banco ANTIGO (local) – usa LOCAL_DATABASE_URL
const local = new PrismaClient({
  datasources: {
    db: {
      url: process.env.LOCAL_DATABASE_URL,
    },
  },
});

async function main() {
  console.log("🛠 Iniciando cópia do banco LOCAL -> REMOTO...");
  console.log("LOCAL_DATABASE_URL:", process.env.LOCAL_DATABASE_URL);
  console.log("DATABASE_URL (REMOTE):", process.env.DATABASE_URL);

  // 1) Buscar tudo do banco antigo (local)
  console.log("📥 Lendo dados do banco LOCAL...");

  const players = await local.player.findMany();
  const matches = await local.match.findMany();
  const playerStats = await local.playerStat.findMany();
  const weeklyAwards = await local.weeklyAward.findMany();
  const monthlyAwards = await local.monthlyAward.findMany();

  console.log(`👤 Players:        ${players.length}`);
  console.log(`⚽ Matches:        ${matches.length}`);
  console.log(`📊 PlayerStats:    ${playerStats.length}`);
  console.log(`🏆 WeeklyAwards:   ${weeklyAwards.length}`);
  console.log(`🌙 MonthlyAwards:  ${monthlyAwards.length}`);

  // 2) Limpar dados do banco REMOTO (Render),
  //    mas mantendo o Admin que já foi criado pelo seed.
  console.log("🧹 Limpando dados do banco REMOTO (menos Admin)...");

  await remote.playerStat.deleteMany();
  await remote.weeklyAward.deleteMany();
  await remote.monthlyAward.deleteMany();
  await remote.match.deleteMany();
  await remote.player.deleteMany();
  // Admin fica quietinho 🙂

  // 3) Inserir dados no banco remoto na ordem certa
  console.log("📤 Inserindo Players no banco REMOTO...");
  if (players.length) {
    await remote.player.createMany({
      data: players.map((p) => ({
        id: p.id,
        name: p.name,
        nickname: p.nickname,
        position: p.position,
        photoUrl: p.photoUrl,
        totalGoals: p.totalGoals,
        totalAssists: p.totalAssists,
        totalMatches: p.totalMatches,
        totalPhotos: p.totalPhotos,
        totalRating: p.totalRating,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      skipDuplicates: true,
    });
  }

  console.log("📤 Inserindo Matches no banco REMOTO...");
  if (matches.length) {
    await remote.match.createMany({
      data: matches.map((m) => ({
        id: m.id,
        playedAt: m.playedAt,
        description: m.description,
        winnerTeam: m.winnerTeam,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
      skipDuplicates: true,
    });
  }

  console.log("📤 Inserindo PlayerStats no banco REMOTO...");
  if (playerStats.length) {
    // pode precisar quebrar em lotes se tiver MUITA coisa, mas por enquanto manda de uma vez
    await remote.playerStat.createMany({
      data: playerStats.map((s) => ({
        id: s.id,
        playerId: s.playerId,
        matchId: s.matchId,
        present: s.present,
        goals: s.goals,
        assists: s.assists,
        rating: s.rating,
        appearedInPhoto: s.appearedInPhoto,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      skipDuplicates: true,
    });
  }

  console.log("📤 Inserindo WeeklyAwards no banco REMOTO...");
  if (weeklyAwards.length) {
    await remote.weeklyAward.createMany({
      data: weeklyAwards.map((w) => ({
        id: w.id,
        weekStart: w.weekStart,
        teamPhotoUrl: w.teamPhotoUrl,
        bestPlayerId: w.bestPlayerId,
        winningMatchId: w.winningMatchId,
        createdAt: w.createdAt,
      })),
      skipDuplicates: true,
    });
  }

  console.log("📤 Inserindo MonthlyAwards no banco REMOTO...");
  if (monthlyAwards.length) {
    await remote.monthlyAward.createMany({
      data: monthlyAwards.map((m) => ({
        id: m.id,
        month: m.month,
        year: m.year,
        craqueId: m.craqueId,
        createdAt: m.createdAt,
      })),
      skipDuplicates: true,
    });
  }

  console.log("✅ Migração concluída com sucesso!");
}

main()
  .catch((err) => {
    console.error("❌ Erro na migração:", err);
  })
  .finally(async () => {
    await local.$disconnect();
    await remote.$disconnect();
    process.exit();
  });
