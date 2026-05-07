const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const puppeteer = require("puppeteer");
const ejs = require("ejs");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");

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

    // Salva cópia em tmp para validação
    const tmpPath = path.join(os.tmpdir(), `player-card-${playerId}.png`);
    fs.writeFileSync(tmpPath, buf);
    console.log(`[share] Cópia salva em: ${tmpPath}`);
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

    const tmpPath = path.join(os.tmpdir(), `voting-result-${matchId}.png`);
    fs.writeFileSync(tmpPath, buf);
    console.log(`[share] Cópia salva em: ${tmpPath}`);
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

module.exports = router;
