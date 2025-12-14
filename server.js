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
const playerRouter = require("./routes/player");
const voteRouter = require("./routes/vote");
const shareRouter = require("./routes/share");

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
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ==============================
// 🎨 Skins dinâmicas
// ==============================
app.use((req, res, next) => {
  const allowedSkins = ["default", "game-day"];
  let skin = null;

  // Prioridade: query > cookie > automática (terça)
  if (req.query.skin && allowedSkins.includes(req.query.skin)) {
    skin = req.query.skin;
    // persiste override por 7 dias
    res.cookie("skin", skin, { maxAge: 7 * 24 * 60 * 60 * 1000 });
  } else if (req.cookies?.skin && allowedSkins.includes(req.cookies.skin)) {
    skin = req.cookies.skin;
  }

  if (!skin) {
    const now = new Date();
    const isTuesday = now.getDay() === 2; // terça-feira
    skin = isTuesday ? "game-day" : "default";
  }

  res.locals.skin = skin;
  res.locals.isGameDay = skin === "game-day";
  next();
});

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
app.use("/jogador", playerRouter);
app.use("/admin", adminRouter);
app.use("/vote", voteRouter);
app.use("/share", shareRouter);


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
  res.locals.isProd = process.env.NODE_ENV === "production";
  next();
});

// ==============================
// 🚀 Start
// ==============================
app.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 http://localhost:${PORT}`);
});

