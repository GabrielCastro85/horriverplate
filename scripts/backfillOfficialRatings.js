require("dotenv").config();
const fs = require("fs");
const path = require("path");
const prisma = require("../utils/db");
const {
  applyOfficialRatings,
  computeMissingOfficialRatings,
  findMatchesMissingOfficialRatings,
} = require("../routes/admin/shared");

/**
 * Preenche as notas vazias das peladas com votação encerrada.
 * Sem --apply só mostra o que mudaria. Com --apply salva antes um arquivo em backups/.
 * Uso: node scripts/backfillOfficialRatings.js [--apply]
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const matches = await findMatchesMissingOfficialRatings();
  const rows = [];
  for (const match of matches) {
    const matchRows = await computeMissingOfficialRatings(match.id);
    rows.push(...matchRows);
    console.log(`${match.playedAt.toISOString().slice(0, 10)} #${match.id}: ${matchRows.length} notas`);
  }

  const playerIds = Array.from(new Set(rows.map((row) => row.playerId)));
  const players = await prisma.player.findMany({
    where: { id: { in: playerIds } },
    select: { id: true, name: true, totalRating: true, overallDynamic: true },
  });
  const notes = rows.map((row) => row.rating);
  console.log(`\nPeladas: ${matches.length} | notas a gravar: ${rows.length} | jogadores: ${players.length}`);
  if (notes.length) {
    console.log(`Menor nota: ${Math.min(...notes)} | maior: ${Math.max(...notes)}`);
  }

  if (!apply) {
    console.log("Nada foi gravado. Rode com --apply para gravar.");
    return;
  }

  const backupDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `notas-antes-do-preenchimento-${Date.now()}.json`);
  const overallHistory = await prisma.overallHistory.findMany({
    where: { window: { startsWith: "last-" } },
    select: { playerId: true, overall: true, window: true, source: true },
  });
  fs.writeFileSync(backupPath, JSON.stringify({ statIds: rows, players, overallHistory }, null, 2));
  console.log(`Estado anterior salvo em ${backupPath}`);

  await applyOfficialRatings(rows);
  console.log(`Notas gravadas: ${rows.length}`);
}

main()
  .catch((err) => {
    console.error("Erro ao preencher notas:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
