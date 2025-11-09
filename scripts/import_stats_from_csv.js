// scripts/import_stats_from_csv.js
//
// Como usar:
// 1) Deixe o arquivo CSV em:
//      /import/estatisticas_import.csv
//    (C:\...\projeto-horriver-plate - 2\import\estatisticas_import.csv)
// 2) Rode no terminal (na pasta do projeto):
//      node scripts/import_stats_from_csv.js
//
// O script:
//  - Lê todas as linhas do CSV
//  - Descobre quais colunas são data, descrição, jogador, gols, etc. (usando os nomes BRUTOS)
//  - Faz casamento de nome com:
//      * normalização (sem acento, sem (GK), sem " - Apelido")
//      * aliases específicos (Meurin -> Luiz Paulo, etc.)
//      * fuzzy match (similaridade de texto)
//  - Cria ou atualiza Match + PlayerStat
//  - Recalcula totais dos jogadores tocados

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const prisma = require("../utils/db");

// ==============================
// 🔤 Normalização de nomes
// ==============================
function normalizeName(str) {
  if (!str) return "";
  let s = String(str).trim();

  // Remove conteúdo entre parênteses: "Breno (GK)" -> "Breno"
  s = s.replace(/\([^)]*\)/g, "");

  // Remove apelidos depois de " - ": "Lucas Leite - Coxinha" -> "Lucas Leite"
  const dashIdx = s.indexOf(" - ");
  if (dashIdx !== -1) s = s.slice(0, dashIdx);

  // Normaliza acentos, sinais e espaços
  s = s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

// ==============================
// 🧭 Aliases específicos (apelidos -> nome oficial do site)
// ==============================
const aliasMap = {
  "meurin": "Luiz Paulo",
  "lucas leite": "Lucas Ferreira",
  "breno": "Breno Amorim",
  "gustavo bumbum": "Gustavo Berbert",
};

// ==============================
// 🔍 Fuzzy match (similaridade de nomes)
// ==============================
function levenshteinDistance(a, b) {
  const matrix = Array(a.length + 1)
    .fill(null)
    .map(() => Array(b.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + indicator
      );
    }
  }

  return matrix[a.length][b.length];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  a = normalizeName(a);
  b = normalizeName(b);
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  const editDistance = levenshteinDistance(longer, shorter);
  return (longerLength - editDistance) / longerLength;
}

function findClosestPlayer(name, playerMap) {
  const norm = normalizeName(name);

  // 1) Tenta alias explícito
  const aliasTarget = aliasMap[norm];
  if (aliasTarget) {
    const targetNorm = normalizeName(aliasTarget);
    const playerFromAlias = playerMap.get(targetNorm);
    if (playerFromAlias) return playerFromAlias;
  }

  // 2) Tenta match direto pelo nome normalizado
  if (playerMap.has(norm)) return playerMap.get(norm);

  // 3) Fuzzy match (similaridade) com todos do mapa
  let bestMatch = null;
  let bestScore = 0;

  for (const [key, player] of playerMap.entries()) {
    const score = similarity(norm, key);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = player;
    }
  }

  // Só aceita se for bem parecido
  if (bestScore >= 0.75) return bestMatch;
  return null;
}

// ==============================
// 🔢 Recalcular totais de jogadores
// ==============================
async function recomputeTotalsForPlayers(playerIds) {
  const uniqueIds = Array.from(new Set(playerIds)).filter(Boolean);
  if (!uniqueIds.length) return;

  for (const id of uniqueIds) {
    const stats = await prisma.playerStat.findMany({ where: { playerId: id } });

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

// ==============================
// 🚀 Função principal
// ==============================
async function main() {
  const csvPath = path.join(__dirname, "..", "import", "estatisticas_import.csv");
  console.log("📥 Lendo CSV:", csvPath);

  if (!fs.existsSync(csvPath)) {
    console.error("❌ Arquivo CSV não encontrado nesse caminho.");
    return;
  }

  const rows = [];

  // 1) Ler CSV inteiro
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  console.log(`📊 ${rows.length} registros carregados.`);

  if (!rows.length) {
    console.log("⚠️ CSV vazio, nada para importar.");
    return;
  }

  // 2) Descobrir nomes reais das colunas (USAR CHAVE BRUTA)
  const sample = rows[0];
  const rawKeys = Object.keys(sample); // sem trim aqui!

  function findKey(needle) {
    needle = needle.toLowerCase();
    const foundRaw = rawKeys.find((k) => k.toLowerCase().includes(needle));
    return foundRaw || null;
  }

  const dataKey = findKey("data");
  const descKey = findKey("descricao");
  const jogadorKey = findKey("jogador");
  const golsKey = findKey("gols");
  const assKey = findKey("assist");
  const notaKey = findKey("nota");
  const presKey = findKey("presen");
  const fotoKey = findKey("foto");

  console.log("🔎 Mapeamento de colunas (usando nomes BRUTOS):");
  console.log("   data      ->", dataKey);
  console.log("   descricao ->", descKey);
  console.log("   jogador   ->", jogadorKey);
  console.log("   gols      ->", golsKey);
  console.log("   assist    ->", assKey);
  console.log("   nota      ->", notaKey);
  console.log("   presente  ->", presKey);
  console.log("   foto      ->", fotoKey);

  if (!dataKey || !jogadorKey) {
    console.error("❌ Não consegui identificar colunas de 'data' ou 'jogador' no CSV.");
    return;
  }

  // 3) Carregar jogadores do banco em um mapa
  const allPlayers = await prisma.player.findMany();
  const playerMap = new Map(); // chave = nome normalizado

  for (const p of allPlayers) {
    const base = normalizeName(p.name);
    if (base && !playerMap.has(base)) {
      playerMap.set(base, p);
    }
    if (p.nickname) {
      const combo = normalizeName(p.name + " " + p.nickname);
      if (combo && !playerMap.has(combo)) {
        playerMap.set(combo, p);
      }
    }
  }

  console.log(`👥 Jogadores no banco: ${allPlayers.length}`);

  const touchedPlayerIds = new Set();
  const unmatchedPlayers = new Set();
  const badDates = [];
  let createdStats = 0;
  let updatedStats = 0;
  const matchCache = new Map(); // "yyyy-mm-dd" -> match

  function toInt(val) {
    if (val == null) return 0;
    const s = val.toString().trim();
    if (!s) return 0;
    const n = parseInt(s, 10);
    return isNaN(n) ? 0 : n;
  }

  function toBool01(val) {
    if (val == null) return false;
    const s = val.toString().trim().toLowerCase();
    if (!s) return false;
    return s === "1" || s === "true" || s === "x" || s === "s" || s === "sim";
  }

  // 4) Processar cada linha
  for (const row of rows) {
    const dataStr = (row[dataKey] || "").toString().trim();
    const descStr = descKey ? (row[descKey] || "").toString().trim() : "";
    const jogadorRaw = (row[jogadorKey] || "").toString().trim();

    if (!dataStr || !jogadorRaw) {
      continue;
    }

    // Data
    const date = new Date(dataStr);
    if (isNaN(date.getTime())) {
      badDates.push(dataStr);
      continue;
    }

    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dateKey = dateOnly.toISOString().slice(0, 10);

    // Match (pelada)
    let match = matchCache.get(dateKey);
    if (!match) {
      match = await prisma.match.findFirst({
        where: { playedAt: dateOnly },
      });

      if (!match) {
        match = await prisma.match.create({
          data: {
            playedAt: dateOnly,
            description: descStr || null,
          },
        });
        console.log(`⚽ Pelada criada para ${dateKey}: id=${match.id}`);
      }
      matchCache.set(dateKey, match);
    }

    // Jogador (com alias + fuzzy)
    const player = findClosestPlayer(jogadorRaw, playerMap);
    if (!player) {
      unmatchedPlayers.add(jogadorRaw);
      continue;
    }

    touchedPlayerIds.add(player.id);

    // Stats
    const gols = toInt(golsKey ? row[golsKey] : 0);
    const assist = toInt(assKey ? row[assKey] : 0);

    let rating = null;
    if (notaKey && row[notaKey] != null && row[notaKey].toString().trim() !== "") {
      const s = row[notaKey].toString().trim().replace(",", ".");
      const n = parseFloat(s);
      if (!isNaN(n)) {
        rating = Math.round(n * 100) / 100;
      }
    }

    const presente = presKey ? toBool01(row[presKey]) : false;
    const foto = fotoKey ? toBool01(row[fotoKey]) : false;

    const hasAnyData =
      presente || gols > 0 || assist > 0 || rating !== null || foto;

    if (!hasAnyData) {
      continue;
    }

    // Upsert em PlayerStat
    const existing = await prisma.playerStat.findFirst({
      where: {
        playerId: player.id,
        matchId: match.id,
      },
    });

    if (existing) {
      await prisma.playerStat.update({
        where: { id: existing.id },
        data: {
          present: presente,
          goals: gols,
          assists: assist,
          rating,
          appearedInPhoto: foto,
        },
      });
      updatedStats++;
    } else {
      await prisma.playerStat.create({
        data: {
          playerId: player.id,
          matchId: match.id,
          present: presente,
          goals: gols,
          assists: assist,
          rating,
          appearedInPhoto: foto,
        },
      });
      createdStats++;
    }
  }

  console.log("\n-----");
  console.log(`✅ Importação concluída.`);
  console.log(`📌 PlayerStats criados:      ${createdStats}`);
  console.log(`📌 PlayerStats atualizados:  ${updatedStats}`);
  console.log(`👤 Jogadores tocados:        ${touchedPlayerIds.size}`);

  if (badDates.length) {
    console.log("\n⚠️ Datas inválidas encontradas (linhas ignoradas):");
    const uniq = Array.from(new Set(badDates));
    uniq.forEach((d) => console.log("  -", d));
  }

  if (unmatchedPlayers.size) {
    console.log("\n🚫 Jogadores NÃO encontrados no banco (mesmo com alias + fuzzy):");
    for (const name of unmatchedPlayers) {
      console.log("  -", name);
    }
  }

  // 5) Recalcular totais
  if (touchedPlayerIds.size > 0) {
    console.log("\n🔁 Recalculando totais de jogadores...");
    await recomputeTotalsForPlayers(Array.from(touchedPlayerIds));
    console.log("✅ Totais atualizados.");
  } else {
    console.log("\nℹ️ Nenhum jogador tocado, nada para recalcular.");
  }
}

main()
  .catch((err) => {
    console.error("❌ Erro ao importar estatísticas:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
