// scripts/importStatsFromExcel.js
//
// Como usar:
//
// 1) Certifique-se de que já existem as peladas (Matches) no banco
//    - você já rodou o importMatchesFromExcel.js antes, então ok.
// 2) Tenha o arquivo "PELADA RESENHA - Copia.xlsx" na raiz do projeto.
// 3) Rode: node scripts/importStatsFromExcel.js
//
// O script:
//  - Percorre abas JAN, FEV, MAR... (ignora TOTAL)
//  - Identifica as colunas de cada pelada (data + PRESENTE)
//  - Para cada jogador (linha), lê: PRESENTE, GOL, ASSIST, NOTA, FOTO
//  - Cria/atualiza PlayerStat para (player, match)
//  - Ao final, recalcula os totais para todos os jogadores tocados.
//
// Requer: npm install xlsx

const path = require("path");
const xlsx = require("xlsx");
const prisma = require("../utils/db");

// ==========================
// Helpers de nome/jogador
// ==========================

// Remove acentos, parênteses com (GK), etc.
function normalizeName(str) {
  if (!str) return "";
  let s = String(str).trim();

  // remove conteúdo entre parênteses, ex: "Breno (GK)" -> "Breno"
  s = s.replace(/\([^)]*\)/g, "");

  // pega só antes de " - " (ex: "Lucas Gama - Passarim" -> "Lucas Gama")
  const dashIdx = s.indexOf(" - ");
  if (dashIdx !== -1) {
    s = s.slice(0, dashIdx);
  }

  // normaliza acentos, caixa, espaços
  s = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

// Recalcula totais de jogadores a partir de PlayerStat
async function recomputeTotalsForPlayers(playerIds) {
  const uniqueIds = Array.from(new Set(playerIds)).filter((id) => !!id);
  if (!uniqueIds.length) return;

  for (const id of uniqueIds) {
    const stats = await prisma.playerStat.findMany({
      where: { playerId: id },
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
      where: { id },
      data: {
        totalGoals: goals,
        totalAssists: assists,
        totalMatches: matches,
        totalPhotos: photos,
        totalRating: avgRating,
      },
    });
  }
}

// ==========================
// Helpers de data / parse
// ==========================

function isDateValue(v) {
  if (!v) return false;
  if (v instanceof Date) return !isNaN(v.getTime());
  if (typeof v === "string") {
    const d = new Date(v);
    return !isNaN(d.getTime());
  }
  if (typeof v === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    return !isNaN(d.getTime());
  }
  return false;
}

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof v === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const ms = v * 24 * 60 * 60 * 1000;
    const d = new Date(excelEpoch.getTime() + ms);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

// Interpreta valor da coluna PRESENTE
function parsePresent(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  return ["x", "p", "1", "sim", "s", "ok"].includes(s);
}

// Interpreta numérico (gols, assist)
function parseIntSafe(v) {
  if (v == null || v === "") return 0;
  const n = parseInt(String(v).replace(",", "."), 10);
  if (isNaN(n)) return 0;
  return n;
}

// Nota (rating) pode ser decimal
function parseFloatOrNull(v) {
  if (v == null || String(v).trim() === "") return null;
  const n = parseFloat(String(v).replace(",", "."));
  if (isNaN(n)) return null;
  return n;
}

// FOTO (apareceu na foto)
function parsePhoto(value) {
  if (value == null) return false;
  const s = String(value).trim().toLowerCase();
  if (!s) return false;
  // Na tua planilha aparece "F" onde teve foto
  return ["x", "1", "sim", "s", "ok", "f"].includes(s);
}

async function main() {
  const excelPath = path.join(__dirname, "..", "PELADA RESENHA - Copia.xlsx");
  console.log("📄 Lendo planilha:", excelPath);

  const workbook = xlsx.readFile(excelPath, { cellDates: true });

  // Abas relevantes (ignoramos TOTAL)
  const sheetNames = workbook.SheetNames.filter(
    (name) => name.toUpperCase() !== "TOTAL"
  );

  console.log("📚 Abas encontradas:", sheetNames.join(", "));

  // Carrega todos os jogadores do banco e monta mapa por nome normalizado
  const allPlayers = await prisma.player.findMany();
  const playerMap = new Map(); // key: normalizedName => player

  for (const p of allPlayers) {
    const baseName = normalizeName(p.name); // ex: "lucas gama"
    if (baseName) {
      if (!playerMap.has(baseName)) {
        playerMap.set(baseName, p);
      }
    }

    // também tentamos com nome + apelido (caso útil depois)
    if (p.nickname) {
      const combo = normalizeName(p.name + " " + p.nickname);
      if (combo && !playerMap.has(combo)) {
        playerMap.set(combo, p);
      }
    }
  }

  console.log(`👥 Jogadores no banco: ${allPlayers.length}`);

  // Carrega todos os matches existentes para mapear por data (yyyy-mm-dd)
  const allMatches = await prisma.match.findMany();
  const matchByDate = new Map(); // "yyyy-mm-dd" -> match

  for (const m of allMatches) {
    const d = m.playedAt;
    if (!d) continue;
    const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const key = dateOnly.toISOString().slice(0, 10);
    matchByDate.set(key, m);
  }

  console.log(`📆 Peladas no banco: ${allMatches.length}`);

  const touchedPlayerIds = new Set();
  const unmatchedPlayers = new Set();
  let statsCreated = 0;
  let statsUpdated = 0;

  for (const sheetName of sheetNames) {
    console.log("\n📑 Processando aba:", sheetName);
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (!rows || rows.length < 5) {
      console.warn(
        `  ⚠️  Aba ${sheetName} tem poucas linhas (esperado >= 5). Pulando.`
      );
      continue;
    }

    // Mesma lógica do script anterior:
    // rows[2] -> linha 3: datas + "JOGADOR"
    // rows[3] -> linha 4: "PRESENTE", "GOL", "ASSIST", "NOTA", (col vazia para FOTO)
    const headerDates = rows[2];
    const headerFlags = rows[3];

    const maxCols = Math.max(headerDates.length, headerFlags.length);
    const matchColumns = [];

    for (let col = 0; col < maxCols; col++) {
      const h1 = headerDates[col];
      const h2 = headerFlags[col];

      const hasDate = isDateValue(h1);
      const isPresente =
        typeof h2 === "string" &&
        h2.toUpperCase().includes("PRESENTE");

      if (hasDate && isPresente) {
        const date = toDate(h1);
        if (!date) continue;

        // Pelo formato da tua planilha:
        // col:     PRESENTE
        // col+1:   GOL
        // col+2:   ASSIST
        // col+3:   NOTA
        // col+4:   FOTO (sem cabeçalho, mas preenchido com "F")
        const goalsCol = col + 1;
        const assistsCol = col + 2;
        const ratingCol = col + 3;
        const photoCol = col + 4 < maxCols ? col + 4 : null;

        matchColumns.push({
          sheet: sheetName,
          presentCol: col,
          goalsCol,
          assistsCol,
          ratingCol,
          photoCol,
          playedAt: date,
        });
      }
    }

    if (!matchColumns.length) {
      console.warn(
        `  ⚠️  Aba ${sheetName}: não encontrei colunas (data + PRESENTE).`
      );
      continue;
    }

    console.log("  📅 Peladas nessa aba:");
    matchColumns.forEach((mc, i) => {
      const d = mc.playedAt;
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      console.log(
        `    #${i + 1} -> data ${dd}/${mm}/${yyyy}, col=${mc.presentCol}`
      );
    });

    // Dados começam a partir da linha 5 (índice 4) em diante
    for (let rowIndex = 4; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      if (!row || !row.length) continue;

      // 👉 Nome está na coluna B (índice 1), coluna A é vazia
      const rawName = row[1];
      if (!rawName || String(rawName).trim() === "") {
        continue;
      }

      const keyName = normalizeName(rawName);
      const player = playerMap.get(keyName);

      if (!player) {
        unmatchedPlayers.add(rawName);
        continue;
      }

      const playerId = player.id;
      touchedPlayerIds.add(playerId);

      // Para cada pelada (coluna) dessa aba, criar/atualizar PlayerStat
      for (const mc of matchColumns) {
        const d = mc.playedAt;
        const dateOnly = new Date(
          d.getFullYear(),
          d.getMonth(),
          d.getDate()
        );
        const matchKey = dateOnly.toISOString().slice(0, 10);
        const match = matchByDate.get(matchKey);

        if (!match) {
          console.warn(
            `  ⚠️  Não encontrei Match no banco para data ${matchKey} (aba ${sheetName}).`
          );
          continue;
        }

        const matchId = match.id;

        const presentVal = row[mc.presentCol];
        const goalsVal = row[mc.goalsCol];
        const assistsVal = row[mc.assistsCol];
        const ratingVal = row[mc.ratingCol];
        const photoVal =
          mc.photoCol != null ? row[mc.photoCol] : null;

        const present = parsePresent(presentVal);
        const goals = parseIntSafe(goalsVal);
        const assists = parseIntSafe(assistsVal);
        const rating = parseFloatOrNull(ratingVal);
        const appearedInPhoto = parsePhoto(photoVal);

        const hasAnyData =
          present ||
          goals > 0 ||
          assists > 0 ||
          rating !== null ||
          appearedInPhoto;

        // Se não tem nada pra esse jogador nessa pelada, apaga stat (se existir) e segue
        if (!hasAnyData) {
          const existing = await prisma.playerStat.findFirst({
            where: { playerId, matchId },
          });
          if (existing) {
            await prisma.playerStat.delete({
              where: { id: existing.id },
            });
          }
          continue;
        }

        // upsert manual: se existir, atualiza; senão cria
        const existing = await prisma.playerStat.findFirst({
          where: { playerId, matchId },
        });

        if (existing) {
          await prisma.playerStat.update({
            where: { id: existing.id },
            data: {
              present,
              goals,
              assists,
              rating,
              appearedInPhoto,
            },
          });
          statsUpdated++;
        } else {
          await prisma.playerStat.create({
            data: {
              playerId,
              matchId,
              present,
              goals,
              assists,
              rating,
              appearedInPhoto,
            },
          });
          statsCreated++;
        }
      }
    }
  }

  console.log("\n-----");
  console.log(`✅ Importação de estatísticas concluída.`);
  console.log(`  PlayerStats criados: ${statsCreated}`);
  console.log(`  PlayerStats atualizados: ${statsUpdated}`);
  console.log(`  Jogadores tocados: ${touchedPlayerIds.size}`);

  if (unmatchedPlayers.size) {
    console.log("\n⚠️ Jogadores na planilha NÃO encontrados no banco:");
    for (const name of unmatchedPlayers) {
      console.log("   -", name);
    }
  }

  // Recalcula totais
  console.log("\n🔁 Recalculando totais dos jogadores tocados...");
  await recomputeTotalsForPlayers(Array.from(touchedPlayerIds));
  console.log("✅ Totais atualizados.");
}

main()
  .catch((err) => {
    console.error("❌ Erro ao importar estatísticas:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
