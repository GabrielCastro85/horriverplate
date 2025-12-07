// scripts/createAdmin.js
const prisma = require("../utils/db");
const bcrypt = require("bcryptjs"); // se der erro de módulo, rode: npm i bcryptjs

async function main() {
  // você pode trocar esses dados se quiser
  const email = "admin@horriver.com";
  const password = "admin123";

  // gera o hash da senha
  const passwordHash = await bcrypt.hash(password, 10);

  // verifica se já existe alguém com esse e-mail
  const existing = await prisma.admin.findUnique({
    where: { email },
  });

  if (existing) {
    console.log("Já existe um admin com esse e-mail:", email);
    return;
  }

  await prisma.admin.create({
    data: {
      email,
      passwordHash,
    },
  });

  console.log("Admin criado com sucesso!");
  console.log("E-mail:", email);
  console.log("Senha :", password);
}

main()
  .catch((err) => {
    console.error("Erro ao criar admin:", err);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
