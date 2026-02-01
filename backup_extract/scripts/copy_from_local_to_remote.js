// scripts/copy_from_local_to_remote.js
require("dotenv").config();
const { Client } = require("pg");

const SOURCE_URL = process.env.LOCAL_DATABASE_URL; // banco antigo (local)
const TARGET_URL = process.env.DATABASE_URL;       // banco novo (Render)

if (!SOURCE_URL || !TARGET_URL) {
  console.error("âŒ LOCAL_DATABASE_URL ou DATABASE_URL nÃ£o definidos no .env");
  process.exit(1);
}

// ConexÃ£o local (sem SSL)
const source = new Client({
  connectionString: SOURCE_URL,
});

// ConexÃ£o REMOTA (Render) - com SSL OBRIGATÃ“RIO
const target = new Client({
  connectionString: TARGET_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function copyTable(tableName, columns, options = {}) {
  const { where = "", orderBy = "id" } = options;

  const whereClause = where ? `WHERE ${where}` : "";
  const orderClause = orderBy ? `ORDER BY "${orderBy}"` : "";

  // â— IMPORTANTE: usar nomes de colunas entre aspas nos SELECT tambÃ©m
  const colSelect = columns.map((c) => `"${c}"`).join(", ");
  const colList = columns.map((c) => `"${c}"`).join(", ");

  console.log(`\nðŸ“¥ Lendo dados da tabela "${tableName}" do banco LOCAL...`);
  const res = await source.query(
    `SELECT ${colSelect} FROM "${tableName}" ${whereClause} ${orderClause};`
  );

  console.log(`   â†’ ${res.rows.length} registros encontrados.`);

  if (!res.rows.length) return;

  const placeholders = (n) =>
    Array.from({ length: n }, (_, i) => `$${i + 1}`).join(", ");

  console.log(`ðŸ“¤ Inserindo dados na tabela "${tableName}" do banco REMOTO...`);

  for (const row of res.rows) {
    const values = columns.map((c) => row[c]);
    await target.query(
      `INSERT INTO "${tableName}" (${colList}) VALUES (${placeholders(
        columns.length
      )});`,
      values
    );
  }

  console.log(`âœ… Tabela "${tableName}" copiada com sucesso.`);
}

async function main() {
  console.log("ðŸ”— Conectando nos bancos...");
  await source.connect();
  await target.connect();
  console.log("âœ… Conectado no banco LOCAL e REMOTO.");

  // 1) Limpa dados do remoto (na ordem certa por causa de FKs)
  console.log("\nðŸš¨ Limpando dados do banco REMOTO (mas mantendo Admin)...");

  await target.query(`DELETE FROM "WeeklyAward";`);
  await target.query(`DELETE FROM "MonthlyAward";`);
  await target.query(`DELETE FROM "PlayerStat";`);
  await target.query(`DELETE FROM "Match";`);
  await target.query(`DELETE FROM "Player";`);

  console.log("âœ… Tabelas de stats, peladas e jogadores limpas no banco REMOTO.");

  // 2) Copia Player
  await copyTable("Player", [
    "id",
    "name",
    "nickname",
    "position",
    "photoUrl",
    "totalGoals",
    "totalAssists",
    "totalMatches",
    "totalPhotos",
    "totalRating",
    "createdAt",
    "updatedAt",
  ]);

  // 3) Copia Match
  await copyTable("Match", [
    "id",
    "playedAt",
    "description",
    "winnerTeam",
    "createdAt",
    "updatedAt",
  ]);

  // 4) Copia PlayerStat
  await copyTable("PlayerStat", [
    "id",
    "playerId",
    "matchId",
    "present",
    "goals",
    "assists",
    "rating",
    "appearedInPhoto",
    "createdAt",
    "updatedAt",
  ]);

  // 5) Copia WeeklyAward
  await copyTable("WeeklyAward", [
    "id",
    "weekStart",
    "teamPhotoUrl",
    "bestPlayerId",
    "winningMatchId",
    "createdAt",
  ]);

  // 6) Copia MonthlyAward
  await copyTable("MonthlyAward", [
    "id",
    "month",
    "year",
    "craqueId",
    "createdAt",
  ]);

  console.log("\nðŸŽ¯ Ajustando sequences (ids auto-increment) no REMOTO...");

  const seqFixes = [
    `SELECT setval(pg_get_serial_sequence('"Player"', 'id'), COALESCE((SELECT MAX(id) FROM "Player"), 1));`,
    `SELECT setval(pg_get_serial_sequence('"Match"', 'id'), COALESCE((SELECT MAX(id) FROM "Match"), 1));`,
    `SELECT setval(pg_get_serial_sequence('"PlayerStat"', 'id'), COALESCE((SELECT MAX(id) FROM "PlayerStat"), 1));`,
    `SELECT setval(pg_get_serial_sequence('"WeeklyAward"', 'id'), COALESCE((SELECT MAX(id) FROM "WeeklyAward"), 1));`,
    `SELECT setval(pg_get_serial_sequence('"MonthlyAward"', 'id'), COALESCE((SELECT MAX(id) FROM "MonthlyAward"), 1));`,
  ];

  for (const q of seqFixes) {
    try {
      await target.query(q);
    } catch (err) {
      console.warn(
        "âš ï¸ Erro ajustando sequence (pode ignorar se tudo estiver funcionando):",
        err.message
      );
    }
  }

  console.log("\nâœ… CÃ³pia concluÃ­da com sucesso!");
}

main()
  .catch((err) => {
    console.error("âŒ Erro ao copiar dados:", err);
  })
  .finally(async () => {
    await source.end();
    await target.end();
    console.log("ðŸ”š ConexÃµes fechadas.");
  });
