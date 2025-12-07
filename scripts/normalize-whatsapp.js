const prisma = require('../utils/db');
const { Prisma } = require('@prisma/client');

function normalizeWhatsapp(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  const trimmed = withCountry.slice(0, 13);
  const cc = trimmed.slice(0, 2);
  const ddd = trimmed.slice(2, 4);
  const rest = trimmed.slice(4);
  if (!ddd || !rest) return `(55)`;
  let formatted;
  if (rest.length > 5) {
    formatted = `${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
  } else if (rest.length > 4) {
    formatted = `${rest.slice(0, 4)}-${rest.slice(4)}`;
  } else {
    formatted = rest;
  }
  return `(${cc}) ${ddd} ${formatted}`.trim();
}

async function main() {
  const players = await prisma.player.findMany({ select: { id: true, whatsapp: true } });
  let updated = 0;
  for (const p of players) {
    const formatted = normalizeWhatsapp(p.whatsapp);
    if (formatted && formatted !== p.whatsapp) {
      await prisma.player.update({ where: { id: p.id }, data: { whatsapp: formatted } });
      updated++;
    }
  }
  console.log(`Normalização concluída. Atualizados: ${updated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
