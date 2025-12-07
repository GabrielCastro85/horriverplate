// Carrega variáveis do .env para que scripts CLI encontrem DATABASE_URL sem precisar exportar no shell
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = prisma;
