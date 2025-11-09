// prisma/seed.js
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed...");

  const email = process.env.ADMIN_EMAIL || "admin@horriver.com";
  const plainPassword = process.env.ADMIN_PASSWORD || "senha123";

  // Verifica se já existe admin com esse e-mail
  const existingAdmin = await prisma.admin.findUnique({
    where: { email },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await prisma.admin.create({
      data: {
        email,
        passwordHash: hashedPassword, // ✅ campo correto do schema
      },
    });

    console.log("✅ Admin criado com sucesso:");
    console.log(`   Email: ${email}`);
    console.log(`   Senha: ${plainPassword}`);
  } else {
    console.log("ℹ️ Admin já existe, nenhum novo admin criado.");
  }

  console.log("🌱 Seed finalizado.");
}

main()
  .catch((e) => {
    console.error("❌ Erro ao executar seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
