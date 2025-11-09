const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Iniciando seed...");

  
  const email = "admin@horriverplate.com";
  const plainPassword = "admin123";

  
  const existingAdmin = await prisma.admin.findUnique({
    where: { email },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    await prisma.admin.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    console.log(`✅ Admin criado: ${email} / ${plainPassword}`);
  } else {
    console.log("ℹ️ Admin já existente, nenhum novo registro criado.");
  }

  console.log("🌱 Seed finalizado com sucesso!");
}

main()
  .catch((e) => {
    console.error("❌ Erro ao executar seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
