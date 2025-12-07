// scripts/assign_player_photos.js
// Reatribui photoUrl para jogadores usando arquivos existentes em public/uploads/players
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const prisma = require("../utils/db");

const PHOTO_DIR = path.join(__dirname, "..", "public", "uploads", "players");

async function main() {
  if (!fs.existsSync(PHOTO_DIR)) {
    console.error("Pasta de fotos nao encontrada:", PHOTO_DIR);
    process.exit(1);
  }

  const files = fs.readdirSync(PHOTO_DIR).filter((f) => !f.startsWith("."));
  if (!files.length) {
    console.error("Nenhuma foto encontrada em", PHOTO_DIR);
    return;
  }

  const players = await prisma.player.findMany({
    select: { id: true, name: true, nickname: true, photoUrl: true },
    orderBy: { name: "asc" },
  });

  const missing = players.filter((p) => !p.photoUrl);
  if (!missing.length) {
    console.log("Todos os jogadores ja tem photoUrl definido.");
    return;
  }

  console.log("Fotos disponiveis:");
  files.forEach((f, idx) => console.log(`${idx + 1}. ${f}`));
  console.log("\nDigite o numero do arquivo para atribuir ao jogador ou Enter para pular.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const p of missing) {
    const label = `${p.name}${p.nickname ? " (" + p.nickname + ")" : ""}`;
    const answer = await rl.question(`Foto para ${label}: `);
    const trimmed = answer.trim();
    if (!trimmed) {
      continue;
    }

    const idx = parseInt(trimmed, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= files.length) {
      console.log("Opcao invalida, pulando.");
      continue;
    }

    const file = files[idx];
    const url = `/uploads/players/${file}`;

    await prisma.player.update({
      where: { id: p.id },
      data: { photoUrl: url },
    });

    console.log(`-> ${label} <- ${file}`);
  }

  rl.close();
}

main()
  .catch((err) => {
    console.error("Erro ao atribuir fotos:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
