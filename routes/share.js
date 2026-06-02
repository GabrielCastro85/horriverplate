const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const ejs = require("ejs");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");
const {
  renderImageFromHtml,
  renderImageFromUrl,
  viewportFor,
} = require("../services/imageRenderer");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

// ── Cache em disco para imagens geradas pelo Puppeteer ─────────────────────
const CACHE_DIR = path.join(os.tmpdir(), "share-image-cache");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}

function cachePath(key) {
  return path.join(CACHE_DIR, key + ".jpg");
}

function readCache(key, maxAgeMs = Infinity) {
  try {
    const p = cachePath(key);
    const stat = fs.statSync(p);
    if (Date.now() - stat.mtimeMs > maxAgeMs) return null;
    return fs.readFileSync(p);
  } catch (_) {
    return null;
  }
}

function writeCache(key, buf) {
  try { fs.writeFileSync(cachePath(key), buf); } catch (_) {}
}

function sendJpeg(res, buffer, filename) {
  res.setHeader("Content-Type", "image/jpeg");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", buffer.length);
  res.setHeader("Cache-Control", "no-store");
  return res.end(buffer);
}

function sendImageError(res, message = "Não foi possível gerar a imagem agora. Tente novamente em alguns segundos.") {
  if (res.headersSent) return;
  return res.status(503).send(message);
}

async function buildShareData(playerId) {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    include: {
      overallHistory: { orderBy: { calculatedAt: "desc" }, take: 2 },
    },
  });
  if (!player) return null;

  const totals = {
    goals:   player.totalGoals   || 0,
    assists: player.totalAssists || 0,
    matches: player.totalMatches || 0,
    photos:  player.totalPhotos  || 0,
  };

  const ovr = Math.round(player.overallDynamic ?? player.baseOverall ?? 60);

  const achievements = await prisma.playerAchievement.findMany({
    where: { playerId, unlockedAt: { not: null } },
    include: { achievement: true },
    take: 10,
  });

  const hist = player.overallHistory || [];
  let ovrTrend = "stable";
  let ovrDelta = 0;
  if (hist.length >= 2) {
    ovrDelta = Math.round(hist[0].overall - hist[1].overall);
    if (ovrDelta > 0) ovrTrend = "up";
    else if (ovrDelta < 0) ovrTrend = "down";
  }

  return { player, totals, ovr, ovrTrend, ovrDelta, achievements };
}

const TEMPLATE = path.join(__dirname, "../views/share/player_card_test.ejs");
const VOTING_TEMPLATE = path.join(__dirname, "../views/share/voting_result.ejs");

// ── Debug: renderiza o HTML do card no browser ─────────────────────────────
router.get("/player-card-test-html", async (req, res) => {
  const playerId = parseInt(req.query.playerId, 10);
  if (isNaN(playerId)) return res.status(400).send("playerId inválido");

  try {
    const data = await buildShareData(playerId);
    if (!data) return res.status(404).send("Jogador não encontrado");

    // baseUrl derivado do request para que as imagens resolvam corretamente
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(TEMPLATE, {
      ...data,
      baseUrl,
      fontCss: getLineupFontCss(),
      logoSmall: logoDataUri,
      logoWatermark: logoDataUri,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── JPEG via Puppeteer ──────────────────────────────────────────────────────
router.get("/player-card-test.jpg", async (req, res) => {
  const playerId = parseInt(req.query.playerId, 10);
  if (isNaN(playerId)) return res.status(400).send("playerId inválido");

  const t0 = Date.now();
  console.log(`[share:player-card] request player #${playerId}`);

  // Cache de 1 hora (dados do jogador podem mudar)
  const cacheKey = `player-card-v2-${playerId}`;
  const cached = readCache(cacheKey, 60 * 60 * 1000);
  if (cached) {
    console.log(`[share:player-card] cache hit player #${playerId} (${Date.now() - t0}ms)`);
    return sendJpeg(res, cached, `player-card-${playerId}.jpg`);
  }

  try {
    // Valida existência do jogador antes de abrir o browser
    const data = await buildShareData(playerId);
    if (!data) return res.status(404).send("Jogador não encontrado");

    const host = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(TEMPLATE, {
      ...data,
      baseUrl: host,
      fontCss: getLineupFontCss(),
      logoSmall: logoDataUri,
      logoWatermark: logoDataUri,
    });
    const buf = await renderImageFromHtml({
      html,
      selector: ".pec-card",
      width: 720,
      height: 900,
      type: "jpeg",
      logPrefix: "[share:player-card]",
      resourceOrigin: host,
    });

    writeCache(cacheKey, buf);
    console.log(`[share:player-card] done player #${playerId} (${data.player.name}) in ${Date.now() - t0}ms`);
    return sendJpeg(res, buf, `player-card-${playerId}.jpg`);
  } catch (err) {
    console.error(`[share:player-card] Erro player #${playerId}:`, err);
    if (!res.headersSent) return sendImageError(res, "Não foi possível gerar o card agora. Tente novamente em alguns segundos.");
  }
});

router.get("/player-card-test.png", (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  return res.redirect(302, `/share/player-card-test.jpg${qs}`);
});

// ── Voting result data builder ─────────────────────────────────────────────
async function buildVotingData(matchId) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { id: true, description: true, playedAt: true },
  });
  if (!match) return null;

  const result = await computeMatchRatingsAndAwards(matchId);
  if (result.error) return null;

  const topScores = Array.from(result.scores.values())
    .sort((a, b) => b.finalRating - a.finalRating)
    .slice(0, 5);

  const publicDir = path.resolve(__dirname, "../public");
  const photoCache = new Map();
  const embedPlayerPhoto = async (player) => {
    if (!player?.photoUrl) return;

    const cacheKey = player.photoUrl;
    if (photoCache.has(cacheKey)) {
      player.photoDataUri = photoCache.get(cacheKey);
      if (!player.photoDataUri) player.photoUrl = null;
      return;
    }

    try {
      const sharp = require("sharp");
      let sourceBuffer = null;

      if (/^https?:\/\//i.test(player.photoUrl)) {
        sourceBuffer = null;
      } else {
        const rel = player.photoUrl.replace(/^\/+/, "");
        const abs = path.resolve(publicDir, rel);
        if (abs.startsWith(publicDir + path.sep) && fs.existsSync(abs)) {
          sourceBuffer = fs.readFileSync(abs);
        }
      }

      if (!sourceBuffer) {
        photoCache.set(cacheKey, null);
        player.photoUrl = null;
        return;
      }

      const photoBuffer = await sharp(sourceBuffer)
        .rotate()
        .resize(180, 180, { fit: "cover", position: "center" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      const dataUri = `data:image/jpeg;base64,${photoBuffer.toString("base64")}`;
      photoCache.set(cacheKey, dataUri);
      player.photoDataUri = dataUri;
    } catch (err) {
      console.warn(`[share:voting-result] foto ignorada (${player.name || player.id || "jogador"}):`, err.message);
      photoCache.set(cacheKey, null);
      player.photoUrl = null;
    }
  };

  await Promise.all([
    ...topScores.map((score) => embedPlayerPhoto(score.player)),
    ...Object.values(result.awards || {}).map((award) => embedPlayerPhoto(award?.player)),
  ]);

  return { match, awards: result.awards, topScores };
}

// ── Debug: renderiza o HTML do card de votação no browser ──────────────────
router.get("/voting-result-html", async (req, res) => {
  const matchId = parseInt(req.query.matchId, 10);
  if (isNaN(matchId)) return res.status(400).send("matchId inválido");

  try {
    const data = await buildVotingData(matchId);
    if (!data) return res.status(404).send("Pelada ou dados de votação não encontrados");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(VOTING_TEMPLATE, {
      ...data,
      baseUrl,
      logoMarkUrl: logoDataUri,
      logoIconUrl: logoDataUri,
      fontCss: getLineupFontCss(),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-voting-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── JPEG via Puppeteer — resultado da votação ──────────────────────────────
router.get("/voting-result.jpg", async (req, res) => {
  const matchId = parseInt(req.query.matchId, 10);
  if (isNaN(matchId)) return res.status(400).send("matchId inválido");

  const t0 = Date.now();
  console.log(`[share:voting-result] request match #${matchId}`);

  // Cache versionado para evitar devolver imagens antigas quando o layout muda.
  const cacheKeyVoting = `voting-result-v6-${matchId}`;
  const cachedVoting = readCache(cacheKeyVoting);
  if (cachedVoting) {
    console.log(`[share:voting-result] cache hit match #${matchId} (${Date.now() - t0}ms)`);
    const data = await buildVotingData(matchId);
    const dateLabel = data
      ? new Date(data.match.playedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, "-")
      : matchId;
    return sendJpeg(res, cachedVoting, `resultado-votacao-${dateLabel}.jpg`);
  }

  try {
    const data = await buildVotingData(matchId);
    if (!data) return res.status(404).send("Pelada ou dados de votação não encontrados");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(VOTING_TEMPLATE, {
      ...data,
      baseUrl,
      logoMarkUrl: logoDataUri,
      logoIconUrl: logoDataUri,
      fontCss: getLineupFontCss(),
    });
    const buf = await renderImageFromHtml({
      html,
      selector: ".vrc-card",
      width: 720,
      height: 1280,
      type: "jpeg",
      logPrefix: "[share:voting-result]",
      resourceOrigin: baseUrl,
    });

    writeCache(cacheKeyVoting, buf);
    console.log(`[share:voting-result] done match #${matchId} in ${Date.now() - t0}ms`);

    const dateLabel = new Date(data.match.playedAt)
      .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      .replace(/\//g, "-");

    return sendJpeg(res, buf, `resultado-votacao-${dateLabel}.jpg`);
  } catch (err) {
    console.error(`[share:voting-result] Erro match #${matchId}:`, err);
    if (!res.headersSent) return sendImageError(res);
  }
});

router.get("/voting-result.png", (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  return res.redirect(302, `/share/voting-result.jpg${qs}`);
});

// ── Monthly craque template ────────────────────────────────────────────────
const MONTHLY_CRAQUE_TEMPLATE = path.join(__dirname, "../views/share/monthly_craque.ejs");

async function buildMonthlyCraqueData(sessionId) {
  const session = await prisma.monthlyVoteSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) return null;

  const candidates = Array.isArray(session.candidates) ? session.candidates : [];
  if (!candidates.length) return null;

  const ballots = await prisma.monthlyVoteBallot.findMany({
    where: { token: { sessionId } },
  });

  const counts = ballots.reduce((acc, b) => {
    acc[b.candidateId] = (acc[b.candidateId] || 0) + 1;
    return acc;
  }, {});

  const winner = [...candidates]
    .map((c) => ({ ...c, votes: counts[c.id] || 0 }))
    .sort((a, b) => {
      if (b.votes !== a.votes) return b.votes - a.votes;
      if (b.score !== a.score) return (b.score || 0) - (a.score || 0);
      return String(a.name || "").localeCompare(String(b.name || ""));
    })[0];

  const currentPlayer = winner?.id
    ? await prisma.player.findUnique({
        where: { id: Number(winner.id) },
        select: { photoUrl: true, name: true, nickname: true },
      })
    : null;

  if (currentPlayer) {
    winner.photoUrl = currentPlayer.photoUrl || winner.photoUrl || null;
    winner.name = winner.name || currentPlayer.name;
    winner.nickname = winner.nickname || currentPlayer.nickname || null;
  }

  await embedMonthlyWinnerPhoto(winner);

  return { winner, mvMonth: session.month, mvYear: session.year };
}

async function embedMonthlyWinnerPhoto(winner) {
  if (!winner?.photoUrl || /^https?:\/\//i.test(winner.photoUrl)) return;

  try {
    const sharp = require("sharp");
    const rel = String(winner.photoUrl).replace(/^\/+/, "");
    const abs = path.resolve(PUBLIC_DIR, rel);
    if (!abs.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(abs)) {
      winner.photoUrl = null;
      return;
    }

    const photoBuffer = await sharp(fs.readFileSync(abs))
      .rotate()
      .resize(320, 320, { fit: "cover", position: "center" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();

    winner.photoDataUri = `data:image/jpeg;base64,${photoBuffer.toString("base64")}`;
  } catch (err) {
    console.warn(`[share:craque-mes] foto ignorada (${winner.name || winner.id || "vencedor"}):`, err.message);
    winner.photoUrl = null;
  }
}

// ── Debug: renderiza HTML do card de craque do mês ─────────────────────────
router.get("/monthly-craque-html", async (req, res) => {
  const sessionId = parseInt(req.query.sessionId, 10);
  if (isNaN(sessionId)) return res.status(400).send("sessionId inválido");

  try {
    const data = await buildMonthlyCraqueData(sessionId);
    if (!data) return res.status(404).send("Sessão ou vencedor não encontrado");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(MONTHLY_CRAQUE_TEMPLATE, {
      ...data,
      baseUrl,
      fontCss: getLineupFontCss(),
      logoMarkUrl: logoDataUri,
      logoIconUrl: logoDataUri,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-monthly-craque-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── JPEG via Puppeteer — card de craque do mês ─────────────────────────────
router.get("/monthly-craque.jpg", async (req, res) => {
  const sessionId = parseInt(req.query.sessionId, 10);
  if (isNaN(sessionId)) return res.status(400).send("sessionId inválido");

  const t0 = Date.now();
  console.log(`[share:craque-mes] request session #${sessionId}`);

  // Cache permanente — vencedor não muda após sessão encerrada
  const cacheKeyCraque = `monthly-craque-v5-${sessionId}`;
  const cachedCraque = readCache(cacheKeyCraque);
  if (cachedCraque) {
    console.log(`[share:craque-mes] cache hit session #${sessionId} (${Date.now() - t0}ms)`);
    const data = await buildMonthlyCraqueData(sessionId);
    return sendJpeg(res, cachedCraque, `craque-do-mes-${data?.mvMonth ?? sessionId}-${data?.mvYear ?? ""}.jpg`);
  }

  try {
    const data = await buildMonthlyCraqueData(sessionId);
    if (!data) return res.status(404).send("Sessão ou vencedor não encontrado");

    const host = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(MONTHLY_CRAQUE_TEMPLATE, {
      ...data,
      baseUrl: host,
      fontCss: getLineupFontCss(),
      logoMarkUrl: logoDataUri,
      logoIconUrl: logoDataUri,
    });
    const buf = await renderImageFromHtml({
      html,
      selector: ".mc-card",
      width: 720,
      height: 900,
      type: "jpeg",
      logPrefix: "[share:craque-mês]",
      resourceOrigin: host,
    });

    writeCache(cacheKeyCraque, buf);
    console.log(`[share:craque-mes] done session #${sessionId} (${data.winner?.name}) in ${Date.now() - t0}ms`);

    return sendJpeg(res, buf, `craque-do-mes-${data.mvMonth}-${data.mvYear}.jpg`);
  } catch (err) {
    console.error(`[share:craque-mes] Erro session #${sessionId}:`, err);
    if (!res.headersSent) return sendImageError(res);
  }
});

router.get("/monthly-craque.png", (req, res) => {
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  return res.redirect(302, `/share/monthly-craque.jpg${qs}`);
});

// ── Lineup card templates ───────────────────────────────────────────────────
const LINEUP_TEMPLATE = path.join(__dirname, "../views/share/lineup_card.ejs");
const TIERLIST_TEMPLATE = path.join(__dirname, "../views/share/tierlist_card.ejs");
const LINEUP_LOGO_SOURCE = path.join(__dirname, "../public/img/logo.jpg");
const LINEUP_FONT_FILES = [
  { family: "Bebas Neue", weight: "400", filename: "BebasNeue-Regular.ttf" },
  { family: "Manrope", weight: "400", filename: "Manrope-Regular.ttf" },
  { family: "Manrope", weight: "600", filename: "Manrope-SemiBold.ttf" },
  { family: "Manrope", weight: "700", filename: "Manrope-Bold.ttf" },
  { family: "Manrope", weight: "800 900", filename: "Manrope-ExtraBold.ttf" },
];
let lineupLogoDataUriPromise = null;
let lineupFontCss = null;

async function getLineupLogoDataUri() {
  if (!lineupLogoDataUriPromise) {
    lineupLogoDataUriPromise = (async () => {
      const sharp = require("sharp");
      const buffer = await sharp(LINEUP_LOGO_SOURCE)
        .resize(384, 384, { fit: "cover", position: "center" })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toBuffer();

      return `data:image/png;base64,${buffer.toString("base64")}`;
    })().catch((err) => {
      lineupLogoDataUriPromise = null;
      throw err;
    });
  }

  return lineupLogoDataUriPromise;
}

function getLineupFontCss() {
  if (!lineupFontCss) {
    lineupFontCss = LINEUP_FONT_FILES.map((font) => {
      const fontPath = path.join(__dirname, "../public/fonts", font.filename);
      const data = fs.readFileSync(fontPath).toString("base64");
      return `
        @font-face {
          font-family: "${font.family}";
          font-style: normal;
          font-weight: ${font.weight};
          font-display: block;
          src: url("data:font/ttf;base64,${data}") format("truetype");
        }
      `;
    }).join("\n");
  }

  return lineupFontCss;
}

function getLineupViewport(format = "story") {
  return viewportFor(format);
}

// ── Debug: renderiza HTML do card de times ─────────────────────────────────
router.post("/lineup-html", async (req, res) => {
  try {
    const { teams, goalkeepers, matchDate, matchDescription } = req.body || {};
    if (!Array.isArray(teams) || !teams.length) return res.status(400).send("times inválidos");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const html = await ejs.renderFile(LINEUP_TEMPLATE, {
      teams,
      goalkeepers: goalkeepers || [],
      matchDate: matchDate || "",
      matchDescription: matchDescription || "Pelada",
      baseUrl,
      logoMarkUrl: logoDataUri,
      logoIconUrl: logoDataUri,
      fontCss: getLineupFontCss(),
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-lineup-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

async function generateLineupJpeg(req, res) {
  const t0 = Date.now();
  const { teams, goalkeepers, matchDate, matchDescription, format } = req.body || {};
  if (!Array.isArray(teams) || !teams.length) return res.status(400).send("times inválidos");

  const viewport = getLineupViewport(format);

  try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const logoDataUri = await getLineupLogoDataUri();
      const html = await ejs.renderFile(LINEUP_TEMPLATE, {
        teams,
        goalkeepers: goalkeepers || [],
        matchDate: matchDate || "",
        matchDescription: matchDescription || "Pelada",
        baseUrl,
        logoMarkUrl: logoDataUri,
        logoIconUrl: logoDataUri,
        fontCss: getLineupFontCss(),
        exporting: true,
      });

      const buf = await renderImageFromHtml({
        html,
        selector: ".lc-card",
        width: viewport.width,
        height: viewport.height,
        type: "jpeg",
        logPrefix: "[share:lineup]",
        scaleToWidth: viewport.width,
        resourceOrigin: baseUrl,
      });

      console.log(`[share:lineup] done ${viewport.format} in ${Date.now() - t0}ms`);
      return sendJpeg(res, buf, "times-sorteio.jpg");
    } catch (err) {
      console.error("[share:lineup] error: ", err);
      if (!res.headersSent) {
        const detail = process.env.NODE_ENV === "production" ? "" : ` (${err.message})`;
        return sendImageError(res, `Não foi possível gerar a imagem dos times. Tente novamente.${detail}`);
      }
    }
}

// ── JPEG via Puppeteer — card de times sorteados ───────────────────────────
router.post("/lineup.jpg", generateLineupJpeg);

// ── Compatibilidade: clientes antigos ainda podem chamar .png ──────────────
router.post("/lineup.png", (req, res) => {
  console.warn("[share] /lineup.png legado: gerando JPEG por compatibilidade.");
  return generateLineupJpeg(req, res);
});

// ── JPEG via Puppeteer — exports de torneio ────────────────────────────────
router.get("/tournament.jpg", async (req, res) => {
  const matchId = parseInt(req.query.matchId, 10);
  if (Number.isNaN(matchId)) return res.status(400).send("matchId inválido");

  const type = req.query.type === "games" ? "games" : "standings";
  const isAdmin = req.query.admin === "1";
  const selector = isAdmin
    ? type === "games" ? "#tournament-games-export-admin" : "#tournament-standings-export-admin"
    : type === "games" ? "#tournament-games-export" : "#tournament-standings-export";
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const pageUrl = isAdmin
    ? `${baseUrl}/admin/matches/${matchId}?export=1#tournament`
    : `${baseUrl}/matches/${matchId}?export=1`;
  const cookies = isAdmin && req.cookies?.adminToken
    ? [{ name: "adminToken", value: req.cookies.adminToken, url: baseUrl, httpOnly: true, sameSite: "Lax" }]
    : [];

  try {
    const buffer = await renderImageFromUrl({
      url: pageUrl,
      selector,
      width: 720,
      height: 900,
      type: "jpeg",
      logPrefix: `[share:tournament:${type}]`,
      cookies,
    });

    return sendJpeg(res, buffer, `tournament-${type}.jpg`);
  } catch (err) {
    console.error(`[share:tournament:${type}] error: `, err);
    return sendImageError(res, "Não foi possível gerar a imagem do torneio agora. Tente novamente em alguns segundos.");
  }
});

// ── JPEG via Puppeteer — tierlist ──────────────────────────────────────────
router.post("/tierlist.jpg", async (req, res) => {
  const { title, tiers, format } = req.body || {};
  if (!Array.isArray(tiers) || !tiers.length) return res.status(400).send("tiers inválidos");

  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const logoDataUri = await getLineupLogoDataUri();
    const viewport = viewportFor(format || "feed");
    const html = await ejs.renderFile(TIERLIST_TEMPLATE, {
      title,
      tiers,
      baseUrl,
      logoUrl: logoDataUri,
      fontCss: getLineupFontCss(),
    });
    const buffer = await renderImageFromHtml({
      html,
      selector: ".tl-card",
      width: viewport.width,
      height: viewport.height,
      type: "jpeg",
      logPrefix: "[share:tierlist]",
      resourceOrigin: baseUrl,
    });

    return sendJpeg(res, buffer, "tierlist-horriver.jpg");
  } catch (err) {
    console.error("[share:tierlist] error: ", err);
    return sendImageError(res, "Não foi possível gerar a imagem da tierlist agora. Tente novamente em alguns segundos.");
  }
});

module.exports = router;
