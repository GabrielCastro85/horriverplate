require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const expressLayouts = require("express-ejs-layouts");

const prisma = require("./utils/db");
const { verifyToken } = require("./utils/auth");

const indexRouter = require("./routes/index");
const adminRouter = require("./routes/admin");
const loginRouter = require("./routes/login");
const rankingsRouter = require("./routes/rankings");
const elencoRouter = require("./routes/elenco");
const sobreRouter = require("./routes/sobre");
const awardsRouter = require("./routes/awards"); // ✅ NOVO: rota da premiação
const votesRouter = require("./routes/votes");

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// 🔧 View engine (EJS + layouts)
// ==============================
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout"); // usa views/layout.ejs como layout padrão

// ==============================
// 🌐 Middlewares básicos
// ==============================
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ==============================
// 🛡️ Middleware: autenticação admin via JWT no cookie
// ==============================
async function setAdminFromToken(req, res, next) {
  try {
    const token = req.cookies?.adminToken;
    if (!token) {
      req.admin = null;
      res.locals.admin = null;
      return next();
    }

    const payload = verifyToken(token);
    if (!payload?.id) {
      req.admin = null;
      res.locals.admin = null;
      return next();
    }

    const admin = await prisma.admin.findUnique({ where: { id: payload.id } });
    if (!admin) {
      req.admin = null;
      res.locals.admin = null;
      return next();
    }

    req.admin = admin;
    res.locals.admin = admin;
    next();
  } catch (err) {
    console.error("⚠️ Erro ao verificar token de admin:", err);
    req.admin = null;
    res.locals.admin = null;
    next();
  }
}

app.use(setAdminFromToken);

// 🔥 Disponibiliza o admin logado para as views
app.use((req, res, next) => {
  res.locals.admin = req.admin || null;
  next();
});

// Deixa disponível a rota atual (pra menus ativos, etc.)
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

// ==============================
// 🚏 Rotas
// ==============================
app.use("/", loginRouter);
app.use("/", indexRouter);
app.use("/rankings", rankingsRouter);
app.use("/elenco", elencoRouter);
app.use("/sobre", sobreRouter);
app.use("/premiacao", awardsRouter); // ✅ NOVO: página de premiação
app.use("/votar", votesRouter);
app.use("/admin", adminRouter);

// ==============================
// 404 – sempre por último
// ==============================
app.use((req, res) => {
  res.status(404).render("404", { title: "404" });
});

// Handler genérico de erro
app.use((err, req, res, next) => {
  console.error("💥 Erro inesperado:", err);
  res.status(500).send("Erro interno do servidor");
});

app.use((req, res, next) => {
  res.locals.isProd = process.env.NODE_ENV === 'production';
  next();
});

// ==============================
// 🚀 Start
// ==============================
app.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 http://localhost:${PORT}`);
});
