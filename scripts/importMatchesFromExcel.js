// scripts/importMatchesFromExcel.js
//
// Como usar:
//
// 1) Coloque o arquivo "PELADA RESENHA - Copia.xlsx" na raiz do projeto,
//    no mesmo nível do server.js.
// 2) Rode: node scripts/importMatchesFromExcel.js
//
// Esse script:
//  - Percorre as abas JAN, FEV, MAR, ..., DEZ (ignora TOTAL)
//  - Em cada aba, olha a linha 3 (datas) e linha 4 ("PRESENTE", "GOL", "ASSIST", "NOTA")
//  - Cada coluna onde (linha3 = data) E (linha4 contém "PRESENTE") é considerada uma pelada
//  - Cria um Match no banco para cada data encontrada (se não existir ainda)
//
// Ele NÃO importa estatísticas nem jogadores ainda, só as peladas.
// Assim você usa o painel admin normalmente para lançar stats depois.
//
// Requer:
//   npm install xlsx

const path = require("path");
const xlsx = require("xlsx");
const prisma = require("../utils/db");

function isDateValue(v) {
  if (!v) return false;

  // Se o xlsx já converteu pra Date
  if (v instanceof Date) return !isNaN(v.getTime());

  // Se vier como string parseável (tipo "2025-01-07" ou "07/01/2025")
  if (typeof v === "string") {
    const d = new Date(v);
    return !isNaN(d.getTime());
  }

  // Se vier como número (serial Excel) — fallback
  if (typeof v === "number") {
    // Excel serial -> JS Date (baseado em 1899-12-30)
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

async function main() {
  // Caminho do arquivo de Excel
  const excelPath = path.join(__dirname, "..", "PELADA RESENHA - Copia.xlsx");

  console.log("📄 Lendo planilha:", excelPath);

  // cellDates: true ajuda a já trazer datas como Date
  const workbook = xlsx.readFile(excelPath, { cellDates: true });

  // Abas que vamos considerar (ignorar "TOTAL")
  const sheetNames = workbook.SheetNames.filter(
    (name) => name.toUpperCase() !== "TOTAL"
  );

  if (!sheetNames.length) {
    console.error("Nenhuma aba válida encontrada na planilha.");
    process.exit(1);
  }

  console.log("📚 Abas encontradas:", sheetNames.join(", "));

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const sheetName of sheetNames) {
    console.log("\n📑 Processando aba:", sheetName);

    const sheet = workbook.Sheets[sheetName];

    // Converte a planilha para uma matriz [linhas][colunas]
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    if (!rows || rows.length < 4) {
      console.warn(
        `  ⚠️  Aba ${sheetName} tem poucas linhas, pulando (esperado >= 4).`
      );
      continue;
    }

    // IMPORTANTE: baseado em como está sua planilha:
    // row3 (índice 2) -> datas das peladas + "JOGADOR"
    // row4 (índice 3) -> "PRESENTE", "GOL", "ASSIST", "NOTA", ...
    const headerDates = rows[2]; // linha 3 do Excel
    const headerFlags = rows[3]; // linha 4 do Excel

    if (!headerDates || !headerFlags) {
      console.warn(
        `  ⚠️  Aba ${sheetName} sem cabeçalho suficiente (linhas 3 e 4).`
      );
      continue;
    }

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

        matchColumns.push({
          sheet: sheetName,
          colIndex: col,
          playedAt: date,
        });
      }
    }

    if (!matchColumns.length) {
      console.warn(
        `  ⚠️  Aba ${sheetName}: não encontrei nenhuma coluna com (data + PRESENTE).`
      );
      continue;
    }

    console.log("  📅 Colunas de pelada encontradas:");
    matchColumns.forEach((mc, i) => {
      const yyyy = mc.playedAt.getFullYear();
      const mm = String(mc.playedAt.getMonth() + 1).padStart(2, "0");
      const dd = String(mc.playedAt.getDate()).padStart(2, "0");
      console.log(
        `    #${i + 1} -> col=${mc.colIndex}, data=${dd}/${mm}/${yyyy}`
      );
    });

    // Criar Matches no banco
    for (const mc of matchColumns) {
      const d = mc.playedAt;

      // normalizar para "só data" (00:00)
      const dateOnly = new Date(d.getFullYear(), d.getMonth(), d.getDate());

      // checar se já existe
      const existing = await prisma.match.findFirst({
        where: {
          playedAt: dateOnly,
        },
      });

      const isoDate = dateOnly.toISOString().slice(0, 10);

      if (existing) {
        console.log(
          `  ⚠️  Já existe pelada com data ${isoDate} (id=${existing.id}) — pulando.`
        );
        totalSkipped++;
        continue;
      }

      const match = await prisma.match.create({
        data: {
          playedAt: dateOnly,
          description: null, // você pode editar depois no painel
          winnerTeam: null, // idem
        },
      });

      console.log(
        `  ✅ Criada pelada (Match) id=${match.id} para data ${isoDate}`
      );
      totalCreated++;
    }
  }

  console.log("\n-----");
  console.log(`✅ Importação concluída.`);
  console.log(`  Peladas criadas: ${totalCreated}`);
  console.log(`  Peladas ignoradas (já existiam): ${totalSkipped}`);
}

main()
  .catch((err) => {
    console.error("❌ Erro ao importar peladas:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
