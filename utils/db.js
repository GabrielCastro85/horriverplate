// Carrega variáveis do .env para que scripts CLI encontrem DATABASE_URL sem precisar exportar no shell
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const SOFT_DELETE_MODELS = new Set(["CashTransaction", "GuestPayment"]);

const prisma = new PrismaClient();

// Soft delete: converte delete/deleteMany em update com deletedAt, filtra registros deletados nas leituras
prisma.$use(async (params, next) => {
  if (!SOFT_DELETE_MODELS.has(params.model)) return next(params);

  if (params.action === "delete") {
    params.action = "update";
    params.args = { where: params.args.where, data: { deletedAt: new Date() } };
  } else if (params.action === "deleteMany") {
    params.action = "updateMany";
    params.args = { where: params.args.where, data: { deletedAt: new Date() } };
  } else if (params.action === "findUnique" || params.action === "findUniqueOrThrow") {
    params.action = params.action === "findUnique" ? "findFirst" : "findFirstOrThrow";
    params.args.where = { ...params.args.where, deletedAt: null };
  } else if (["findFirst", "findFirstOrThrow", "findMany", "count"].includes(params.action)) {
    params.args = params.args ?? {};
    params.args.where = { ...params.args.where, deletedAt: null };
  }

  return next(params);
});

module.exports = prisma;
