require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const expressLayouts = require("express-ejs-layouts");
const compression = require("compression");

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

let sharp = null;
try {
  sharp = require("sharp");
} catch (err) {
  console.warn("Sharp not available, thumbnails disabled.");
}

const PUBLIC_DIR = path.join(__dirname, "public");
const CSS_BUNDLE_PATH = path.join(PUBLIC_DIR, "css", "output.css");
const ASSET_VERSION =
  process.env.ASSET_VERSION ||
  (() => {
    try {
      return String(fs.statSync(CSS_BUNDLE_PATH).mtimeMs);
    } catch (err) {
      return String(Date.now());
    }
  })();

const app = express();
const PORT = process.env.PORT || 3000;

// ==============================
// 🔧 View engine (EJS + layouts)
// ==============================
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
app.use(expressLayouts);
app.set("layout", "layout"); // usa views/layout.ejs como layout padrão
app.locals.assetVersion = ASSET_VERSION;
app.locals.thumbUrl = (url, width) => {
  if (!url || !width) return url;
  if (!url.startsWith("/uploads/") && !url.startsWith("/img/")) return url;
  const w = Math.max(40, Math.min(1200, parseInt(width, 10) || 0));
  if (!w) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}w=${w}`;
};

// ==============================
// 🌐 Middlewares básicos
// ==============================
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.get(["/uploads/*", "/img/*"], async (req, res, next) => {
  const width = parseInt(req.query.w, 10);
  if (!sharp || !width || width < 40 || width > 1600) return next();

  try {
    const relPath = decodeURIComponent(req.path).replace(/^\/+/, "");
    const absPath = path.join(PUBLIC_DIR, relPath);
    if (!absPath.startsWith(PUBLIC_DIR)) return next();
    if (!fs.existsSync(absPath)) return next();

    const ext = path.extname(absPath).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return next();

    const cacheDir = path.join(PUBLIC_DIR, ".thumbs", path.dirname(relPath));
    const baseName = path.basename(relPath, ext);
    const cacheFile = path.join(cacheDir, `${baseName}_w${width}.webp`);

    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (!fs.existsSync(cacheFile)) {
      await sharp(absPath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 76 })
        .toFile(cacheFile);
    }

    res.set("Cache-Control", "public, max-age=2592000, immutable");
    return res.sendFile(cacheFile);
  } catch (err) {
    console.warn("Thumbnail error:", err);
    return next();
  }
});
app.use(
  express.static(PUBLIC_DIR, {
    maxAge: "7d",
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}.thumbs${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      }
    },
  })
);
app.use((req, res, next) => {
  res.locals.isProd = process.env.NODE_ENV === "production";
  next();
});
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (
    req.path.startsWith("/admin") ||
    req.path.startsWith("/login") ||
    req.path.startsWith("/vote") ||
    req.path.startsWith("/logout")
  ) {
    return next();
  }
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  next();
});

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

app.use((req, res, next) => {
  const baseUrl =
    process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
  const metaMap = [
    { path: "/", description: "Estatisticas, rankings e resenha da pelada Horriver Plate." },
    { path: "/rankings", description: "Rankings atualizados da pelada com filtros por periodo." },
    { path: "/elenco", description: "Elenco completo de jogadores do Horriver Plate." },
    { path: "/peladas", description: "Lista de peladas com filtros por mes e ano." },
    { path: "/hall-da-fama", description: "Hall da fama e premiacoes do Horriver Plate." },
    { path: "/premiacao", description: "Premiacoes e destaques do Horriver Plate." },
    { path: "/sobre", description: "Historia e informacoes do Horriver Plate." },
  ];

  const match = metaMap.find((item) =>
    req.path === item.path || req.path.startsWith(`${item.path}/`)
  );
  const fallbackDescription =
    "Pelada, stats e resenha do Horriver Plate.";

  res.locals.metaDescription =
    res.locals.metaDescription || (match && match.description) || fallbackDescription;
  res.locals.metaUrl = res.locals.metaUrl || `${baseUrl}${req.originalUrl}`;
  res.locals.metaImage =
    res.locals.metaImage || `${baseUrl}/img/logo.jpg`;
  next();
});

app.post("/monitoring/frontend-error", (req, res) => {
  const payload = req.body || {};
  const safePayload = {
    type: payload.type || "error",
    message: payload.message,
    url: payload.url,
    stack: payload.stack,
    userAgent: payload.userAgent,
    createdAt: new Date().toISOString(),
  };
  console.warn("Frontend error:", safePayload);
  res.status(204).end();
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

// ==============================
// 🚀 Start
// ==============================
app.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
  console.log(`🌍 http://localhost:${PORT}`);
});



