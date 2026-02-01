// scripts/importMatches.js
//
// Como usar:
// 1) Coloque um arquivo peladas.csv na raiz do projeto (mesmo nÃ­vel de server.js)
// 2) Formato do CSV (com cabeÃ§alho):
//    playedAt,description,winnerTeam
//    2025-01-10,Pelada da sexta,Time Azul
//    2025-01-17,Pelada da sexta,Time Vermelho
//
// 3) Rode: node scripts/importMatches.js

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const prisma = require("../utils/db");

async function main() {
  const csvPath = path.join(__dirname, "..", "peladas.csv");

  if (!fs.existsSync(csvPath)) {
    console.error("Arquivo peladas.csv nÃ£o encontrado na raiz do projeto.");
    console.error("Crie o arquivo e rode o script novamente.");
    process.exit(1);
  }

  const fileStream = fs.createReadStream(csvPath);

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let isHeader = true;
  let count = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // pula cabeÃ§alho
    if (isHeader) {
      isHeader = false;
      continue;
    }

    // separa por vÃ­rgula â€” se sua planilha estiver usando ; em vez de ,,
    // troque o split abaixo para split(";")
    const parts = trimmed.split(",");

    const playedAtRaw = parts[0]?.trim();
    const descriptionRaw = parts[1]?.trim();
    const winnerTeamRaw = parts[2]?.trim();

    if (!playedAtRaw) {
      console.warn("Linha ignorada (sem data):", line);
      continue;
    }

    // datas no formato YYYY-MM-DD
    const playedAt = new Date(playedAtRaw);
    if (isNaN(playedAt.getTime())) {
      console.warn("Data invÃ¡lida, linha ignorada:", line);
      continue;
    }

    const description = descriptionRaw || null;
    const winnerTeam = winnerTeamRaw || null;

    await prisma.match.create({
      data: {
        playedAt,
        description,
        winnerTeam,
      },
    });

    count++;
  }

  console.log(`âœ… ImportaÃ§Ã£o concluÃ­da. ${count} peladas criadas.`);
}

main()
  .catch((err) => {
    console.error("Erro ao importar peladas:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
