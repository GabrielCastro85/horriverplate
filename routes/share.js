const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");

// ── Cache em disco para PNGs gerados pelo Puppeteer ────────────────────────
const CACHE_DIR = path.join(os.tmpdir(), "share-png-cache");
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (_) {}

function cachePath(key) {
  return path.join(CACHE_DIR, key + ".png");
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
    const html = await ejs.renderFile(TEMPLATE, { ...data, baseUrl });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── PNG via Puppeteer ───────────────────────────────────────────────────────
router.get("/player-card-test.png", async (req, res) => {
  const playerId = parseInt(req.query.playerId, 10);
  if (isNaN(playerId)) return res.status(400).send("playerId inválido");

  const t0 = Date.now();
  console.log(`[share] Iniciando card PNG — player #${playerId}`);

  // Cache de 1 hora (dados do jogador podem mudar)
  const cacheKey = `player-card-${playerId}`;
  const cached = readCache(cacheKey, 60 * 60 * 1000);
  if (cached) {
    console.log(`[share] Cache hit — player #${playerId} (${Date.now() - t0}ms)`);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="player-card-${playerId}.png"`);
    res.setHeader("Content-Length", cached.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(cached);
  }

  let browser;
  try {
    // Valida existência do jogador antes de abrir o browser
    const data = await buildShareData(playerId);
    if (!data) return res.status(404).send("Jogador não encontrado");

    // URL do HTML debug — Puppeteer navega para cá e carrega todos os assets via HTTP
    const host = `${req.protocol}://${req.get("host")}`;
    const htmlUrl = `${host}/share/player-card-test-html?playerId=${playerId}`;
    console.log(`[share] Navegando para: ${htmlUrl}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });

    const page = await browser.newPage();
    // Viewport generoso para acomodar o card 800px sem clipar
    await page.setViewport({ width: 900, height: 1100, deviceScaleFactor: 2 });

    // goto carrega a página completa com todos os assets resolvidos via HTTP
    await page.goto(htmlUrl, { waitUntil: "networkidle0", timeout: 30000 });

    // Aguarda fontes
    await page.evaluateHandle(() => document.fonts.ready);

    // Aguarda imagens e loga as que falharam
    const failedImages = await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 8000);
              })
        )
      );
      return Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.src);
    });

    if (failedImages.length) {
      console.warn(`[share] Imagens que falharam (${failedImages.length}):`, failedImages);
    }

    // Captura somente o elemento do card, sem fundo externo
    const cardElement = await page.$(".pec-card");
    if (!cardElement) throw new Error("Elemento .pec-card não encontrado na página");

    const raw = await cardElement.screenshot({ type: "png", omitBackground: true });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    console.log(`[share] Buffer: ${buf.length} bytes`);
    if (buf.length === 0) throw new Error("Screenshot retornou 0 bytes");

    writeCache(cacheKey, buf);
    console.log(`[share] Concluído em ${Date.now() - t0}ms — player #${playerId} (${data.player.name})`);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="player-card-${playerId}.png"`);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(buf);
  } catch (err) {
    console.error(`[share] Erro — player #${playerId}:`, err);
    if (!res.headersSent) {
      res.status(500).send(`Erro ao gerar card: ${err.message}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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
    const html = await ejs.renderFile(VOTING_TEMPLATE, { ...data, baseUrl });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-voting-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── PNG via Puppeteer — resultado da votação ────────────────────────────────
router.get("/voting-result.png", async (req, res) => {
  const matchId = parseInt(req.query.matchId, 10);
  if (isNaN(matchId)) return res.status(400).send("matchId inválido");

  const t0 = Date.now();
  console.log(`[share] Iniciando voting result PNG — match #${matchId}`);

  // Cache permanente — resultado de votação não muda após encerrado
  const cacheKeyVoting = `voting-result-${matchId}`;
  const cachedVoting = readCache(cacheKeyVoting);
  if (cachedVoting) {
    console.log(`[share] Cache hit — voting result match #${matchId} (${Date.now() - t0}ms)`);
    const data = await buildVotingData(matchId);
    const dateLabel = data
      ? new Date(data.match.playedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, "-")
      : matchId;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="resultado-votacao-${dateLabel}.png"`);
    res.setHeader("Content-Length", cachedVoting.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(cachedVoting);
  }

  let browser;
  try {
    const data = await buildVotingData(matchId);
    if (!data) return res.status(404).send("Pelada ou dados de votação não encontrados");

    const host = `${req.protocol}://${req.get("host")}`;
    const htmlUrl = `${host}/share/voting-result-html?matchId=${matchId}`;
    console.log(`[share] Navegando para: ${htmlUrl}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 1800, deviceScaleFactor: 2 });

    await page.goto(htmlUrl, { waitUntil: "networkidle0", timeout: 30000 });

    await page.evaluateHandle(() => document.fonts.ready);

    const failedImages = await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 8000);
              })
        )
      );
      return Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.src);
    });

    if (failedImages.length) {
      console.warn(`[share] Imagens que falharam (${failedImages.length}):`, failedImages);
    }

    const cardElement = await page.$(".vrc-card");
    if (!cardElement) throw new Error("Elemento .vrc-card não encontrado na página");

    const raw = await cardElement.screenshot({ type: "png", omitBackground: true });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    console.log(`[share] Buffer: ${buf.length} bytes`);
    if (buf.length === 0) throw new Error("Screenshot retornou 0 bytes");

    writeCache(cacheKeyVoting, buf);
    console.log(`[share] Concluído em ${Date.now() - t0}ms — match #${matchId}`);

    const dateLabel = new Date(data.match.playedAt)
      .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      .replace(/\//g, "-");

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="resultado-votacao-${dateLabel}.png"`);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(buf);
  } catch (err) {
    console.error(`[share] Erro voting result — match #${matchId}:`, err);
    if (!res.headersSent) {
      res.status(500).send(`Erro ao gerar imagem: ${err.message}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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

  return { winner, mvMonth: session.month, mvYear: session.year };
}

// ── Debug: renderiza HTML do card de craque do mês ─────────────────────────
router.get("/monthly-craque-html", async (req, res) => {
  const sessionId = parseInt(req.query.sessionId, 10);
  if (isNaN(sessionId)) return res.status(400).send("sessionId inválido");

  try {
    const data = await buildMonthlyCraqueData(sessionId);
    if (!data) return res.status(404).send("Sessão ou vencedor não encontrado");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const html = await ejs.renderFile(MONTHLY_CRAQUE_TEMPLATE, { ...data, baseUrl });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-monthly-craque-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── PNG via Puppeteer — card de craque do mês ──────────────────────────────
router.get("/monthly-craque.png", async (req, res) => {
  const sessionId = parseInt(req.query.sessionId, 10);
  if (isNaN(sessionId)) return res.status(400).send("sessionId inválido");

  const t0 = Date.now();
  console.log(`[share] Iniciando monthly craque PNG — session #${sessionId}`);

  // Cache permanente — vencedor não muda após sessão encerrada
  const cacheKeyCraque = `monthly-craque-${sessionId}`;
  const cachedCraque = readCache(cacheKeyCraque);
  if (cachedCraque) {
    console.log(`[share] Cache hit — monthly craque session #${sessionId} (${Date.now() - t0}ms)`);
    const data = await buildMonthlyCraqueData(sessionId);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="craque-do-mes-${data?.mvMonth ?? sessionId}-${data?.mvYear ?? ""}.png"`);
    res.setHeader("Content-Length", cachedCraque.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(cachedCraque);
  }

  let browser;
  try {
    const data = await buildMonthlyCraqueData(sessionId);
    if (!data) return res.status(404).send("Sessão ou vencedor não encontrado");

    const host = `${req.protocol}://${req.get("host")}`;
    const htmlUrl = `${host}/share/monthly-craque-html?sessionId=${sessionId}`;
    console.log(`[share] Navegando para: ${htmlUrl}`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 2 });

    await page.goto(htmlUrl, { waitUntil: "networkidle0", timeout: 30000 });
    await page.evaluateHandle(() => document.fonts.ready);

    const failedImages = await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 8000);
              })
        )
      );
      return Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.src);
    });

    if (failedImages.length) {
      console.warn(`[share] Imagens com falha (${failedImages.length}):`, failedImages);
    }

    const cardElement = await page.$(".mc-card");
    if (!cardElement) throw new Error("Elemento .mc-card não encontrado na página");

    const raw = await cardElement.screenshot({ type: "png", omitBackground: true });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    if (buf.length === 0) throw new Error("Screenshot retornou 0 bytes");

    writeCache(cacheKeyCraque, buf);
    console.log(`[share] Concluído em ${Date.now() - t0}ms — session #${sessionId} (${data.winner?.name})`);

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="craque-do-mes-${data.mvMonth}-${data.mvYear}.png"`
    );
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(buf);
  } catch (err) {
    console.error(`[share] Erro monthly craque — session #${sessionId}:`, err);
    if (!res.headersSent) res.status(500).send(`Erro ao gerar imagem: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

// ── Lineup card templates ───────────────────────────────────────────────────
const LINEUP_TEMPLATE = path.join(__dirname, "../views/share/lineup_card.ejs");

// ── Debug: renderiza HTML do card de times ─────────────────────────────────
router.post("/lineup-html", async (req, res) => {
  try {
    const { teams, goalkeepers, matchDate, matchDescription } = req.body || {};
    if (!Array.isArray(teams) || !teams.length) return res.status(400).send("times inválidos");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const html = await ejs.renderFile(LINEUP_TEMPLATE, {
      teams,
      goalkeepers: goalkeepers || [],
      matchDate: matchDate || "",
      matchDescription: matchDescription || "Pelada",
      baseUrl,
    });

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.end(html);
  } catch (err) {
    console.error("[share-lineup-html] Erro:", err);
    res.status(500).send(`<pre>${err.message}\n\n${err.stack}</pre>`);
  }
});

// ── PNG via Puppeteer — card de times sorteados ────────────────────────────
router.post("/lineup.png", async (req, res) => {
  const t0 = Date.now();
  let browser;
  try {
    const { teams, goalkeepers, matchDate, matchDescription } = req.body || {};
    if (!Array.isArray(teams) || !teams.length) return res.status(400).send("times inválidos");

    console.log(`[share] Iniciando lineup PNG — ${teams.length} times`);

    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--hide-scrollbars",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1500, height: 1800, deviceScaleFactor: 2 });

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const html = await ejs.renderFile(LINEUP_TEMPLATE, {
      teams,
      goalkeepers: goalkeepers || [],
      matchDate: matchDate || "",
      matchDescription: matchDescription || "Pelada",
      baseUrl,
    });

    // domcontentloaded evita travar esperando Google Fonts CDN fechar conexão
    // Primeiro navega para a mesma origem dos assets para evitar bloqueio CORP/NotSameOrigin.
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Aguarda fontes com timeout de segurança
    await Promise.race([
      page.evaluateHandle(() => document.fonts.ready),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    // Buffer mínimo para renderização
    await new Promise((r) => setTimeout(r, 200));

    const failedImages = await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 8000);
              })
        )
      );
      return Array.from(document.images)
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.src);
    });

    if (failedImages.length) {
      console.warn(`[share] Imagens com falha (${failedImages.length}):`, failedImages);
    }

    const cardEl = await page.$(".lc-card");
    if (!cardEl) throw new Error("Elemento .lc-card não encontrado");

    const raw = await cardEl.screenshot({ type: "png", omitBackground: true });
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

    if (buf.length === 0) throw new Error("Screenshot retornou 0 bytes");

    const tmpPath = path.join(os.tmpdir(), `lineup-${Date.now()}.png`);
    fs.writeFileSync(tmpPath, buf);
    console.log(`[share] Lineup PNG — ${buf.length} bytes em ${Date.now() - t0}ms`);

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `attachment; filename="times-sorteio.png"`);
    res.setHeader("Content-Length", buf.length);
    res.setHeader("Cache-Control", "no-store");
    return res.end(buf);
  } catch (err) {
    console.error("[share] Erro lineup PNG:", err);
    if (!res.headersSent) res.status(500).send(`Erro ao gerar imagem: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

module.exports = router;
