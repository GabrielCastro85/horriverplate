const express = require("express");
const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const prisma = require("../../utils/db");
const { formatPlayerLabel, formatPositionShort, formatNumberBR } = require("../../utils/adminFormat");
const { renderImageFromUrl } = require("../../utils/puppeteer");
const router = express.Router();

let puppeteer = null;

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// PDF report definitions
// ==============================

const ADMIN_PDF_REPORTS = [
  {
    key: "attendance-full",
    title: "Ranking de Presença Completo",
    description: "Todos os jogadores ordenados por número de presenças registradas.",
    filename: "ranking-presença-completo.pdf",
    metricKey: "totalMatches",
    metricLabel: "Presenças",
    limit: null,
    nonZeroOnly: false,
    accent: "#ff7a1a",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "matches", label: "Presenças", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
    ],
  },
  {
    key: "attendance-top10",
    title: "Top 10 de Presenças",
    description: "Os 10 jogadores que mais marcaram presença nas peladas.",
    filename: "top-10-presenças.pdf",
    metricKey: "totalMatches",
    metricLabel: "Presenças",
    limit: 10,
    nonZeroOnly: true,
    accent: "#ff7a1a",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "matches", label: "Presenças", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
    ],
  },
  {
    key: "attendance-top20",
    title: "Top 20 de Presenças",
    description: "Os 20 jogadores com mais presenças acumuladas.",
    filename: "top-20-presenças.pdf",
    metricKey: "totalMatches",
    metricLabel: "Presenças",
    limit: 20,
    nonZeroOnly: true,
    accent: "#ff7a1a",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "matches", label: "Presenças", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
    ],
  },
  {
    key: "goals-top10",
    title: "Top 10 Artilheiros",
    description: "Ranking geral de gols marcados em todas as peladas.",
    filename: "top-10-artilheiros.pdf",
    metricKey: "totalGoals",
    metricLabel: "Gols",
    limit: 10,
    nonZeroOnly: true,
    accent: "#ef4444",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
    ],
  },
  {
    key: "assists-top10",
    title: "Top 10 Assistências",
    description: "Jogadores com mais assistências no histórico completo.",
    filename: "top-10-assistências.pdf",
    metricKey: "totalAssists",
    metricLabel: "Assistências",
    limit: 10,
    nonZeroOnly: true,
    accent: "#3b82f6",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "assists", label: "Assist.", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
    ],
  },
  {
    key: "ratings-top10",
    title: "Top 10 Notas Gerais",
    description: "Melhores médias registradas no banco geral do site.",
    filename: "top-10-notas-gerais.pdf",
    metricKey: "totalRating",
    metricLabel: "Nota",
    limit: 10,
    nonZeroOnly: true,
    accent: "#facc15",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "rating", label: "Nota", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
    ],
  },
];

const ADMIN_PDF_REPORTS_BY_KEY = new Map(ADMIN_PDF_REPORTS.map((report) => [report.key, report]));

function getAdminPdfReportsList() {
  return ADMIN_PDF_REPORTS.map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    href: `/admin/reports/pdf/${report.key}`,
  }));
}

function buildAdminPdfRows(report, players) {
  const rows = players
    .map((player) => ({
      player,
      metricSortValue: Number(player?.[report.metricKey] || 0),
    }))
    .filter((entry) => !report.nonZeroOnly || entry.metricSortValue > 0)
    .sort((a, b) => {
      if (b.metricSortValue !== a.metricSortValue) {
        return b.metricSortValue - a.metricSortValue;
      }
      if ((b.player?.totalMatches || 0) !== (a.player?.totalMatches || 0)) {
        return (b.player?.totalMatches || 0) - (a.player?.totalMatches || 0);
      }
      return String(a.player?.name || "").localeCompare(String(b.player?.name || ""), "pt-BR");
    });

  const sliced = report.limit ? rows.slice(0, report.limit) : rows;

  return sliced.map(({ player }, index) => ({
    rank: String(index + 1),
    player: formatPlayerLabel(player),
    position: formatPositionShort(player?.position),
    matches: formatNumberBR(player?.totalMatches || 0),
    goals: formatNumberBR(player?.totalGoals || 0),
    assists: formatNumberBR(player?.totalAssists || 0),
    photos: formatNumberBR(player?.totalPhotos || 0),
    rating: formatNumberBR(player?.totalRating || 0, 2),
  }));
}

const ADMIN_PDF_GENERATOR_REPORTS = [
  {
    key: "attendance",
    title: "Ranking de Presença",
    description: "Jogadores ordenados pelo número de presenças registradas.",
    filenameBase: "ranking-presença",
    metricKey: "totalMatches",
    metricLabel: "Presenças",
    defaultLimit: null,
    nonZeroOnly: false,
    accent: "#ff7a1a",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "matches", label: "Presenças", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
    ],
  },
  {
    key: "goals",
    title: "Ranking de Artilheiros",
    description: "Jogadores com mais gols no histórico completo do site.",
    filenameBase: "ranking-artilheiros",
    metricKey: "totalGoals",
    metricLabel: "Gols",
    defaultLimit: 10,
    nonZeroOnly: true,
    accent: "#ef4444",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "goals", label: "Gols", align: "right" },
      { key: "assists", label: "Assist.", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
    ],
  },
  {
    key: "assists",
    title: "Ranking de Assistências",
    description: "Jogadores com mais assistências no histórico completo.",
    filenameBase: "ranking-assistências",
    metricKey: "totalAssists",
    metricLabel: "Assistências",
    defaultLimit: 10,
    nonZeroOnly: true,
    accent: "#3b82f6",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "assists", label: "Assist.", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
    ],
  },
  {
    key: "ratings",
    title: "Ranking de Notas Gerais",
    description: "Melhores médias registradas no banco geral do site.",
    filenameBase: "ranking-notas-gerais",
    metricKey: "totalRating",
    metricLabel: "Nota",
    defaultLimit: 10,
    nonZeroOnly: true,
    accent: "#facc15",
    columns: [
      { key: "rank", label: "#", align: "right" },
      { key: "player", label: "Jogador" },
      { key: "position", label: "Pos." },
      { key: "rating", label: "Nota", align: "right" },
      { key: "matches", label: "Peladas", align: "right" },
      { key: "goals", label: "Gols", align: "right" },
    ],
  },
];

const ADMIN_PDF_GENERATOR_BY_KEY = new Map(ADMIN_PDF_GENERATOR_REPORTS.map((report) => [report.key, report]));
const ADMIN_PDF_GENERATOR_ALIASES = new Map([
  ["attendance-full", { reportKey: "attendance", limit: null }],
  ["attendance-top10", { reportKey: "attendance", limit: 10 }],
  ["attendance-top20", { reportKey: "attendance", limit: 20 }],
  ["goals-top10", { reportKey: "goals", limit: 10 }],
  ["assists-top10", { reportKey: "assists", limit: 10 }],
  ["ratings-top10", { reportKey: "ratings", limit: 10 }],
]);
const ADMIN_PDF_LIMIT_OPTIONS = [
  { value: "all", label: "Completo" },
  { value: "10", label: "Top 10" },
  { value: "20", label: "Top 20" },
  { value: "30", label: "Top 30" },
  { value: "50", label: "Top 50" },
];

function normalizeAdminPdfGeneratorLimit(limitValue, fallback = null) {
  const raw = String(limitValue ?? "").trim().toLowerCase();
  if (!raw || raw === "all" || raw === "full" || raw === "completo") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(200, Math.floor(parsed));
}

function resolveAdminPdfGeneratorSelection(reportKey, limitValue) {
  let baseReport = ADMIN_PDF_GENERATOR_BY_KEY.get(reportKey);
  let fallbackLimit = null;

  if (!baseReport) {
    const alias = ADMIN_PDF_GENERATOR_ALIASES.get(reportKey);
    if (!alias) return null;
    baseReport = ADMIN_PDF_GENERATOR_BY_KEY.get(alias.reportKey);
    fallbackLimit = alias.limit;
  }

  if (!baseReport) return null;

  const resolvedLimit = normalizeAdminPdfGeneratorLimit(
    limitValue,
    fallbackLimit ?? baseReport.defaultLimit ?? null
  );
  const isFull = resolvedLimit == null;

  return {
    ...baseReport,
    title: isFull ? `${baseReport.title} Completo` : `${baseReport.title} - Top ${resolvedLimit}`,
    description: isFull
      ? baseReport.description: `${baseReport.description} Recorte com os ${resolvedLimit} primeiros nomes do ranking.`,
    filename: `${baseReport.filenameBase}-${isFull ? "completo" : `top-${resolvedLimit}`}.pdf`,
    limit: resolvedLimit,
    limitLabel: isFull ? "Completo" : `Top ${resolvedLimit}`,
  };
}

function getAdminPdfGeneratorOptions() {
  return ADMIN_PDF_GENERATOR_REPORTS.map((report) => ({
    key: report.key,
    title: report.title,
    description: report.description,
    defaultLimit: report.defaultLimit == null ? "all" : String(report.defaultLimit),
  }));
}

// ==============================
// Puppeteer helpers
// ==============================

function resolveBrowserExecutablePath() {
  const explicitPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean);

  for (const candidate of explicitPaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (puppeteer && typeof puppeteer.executablePath === "function") {
    try {
      const bundledPath = puppeteer.executablePath();
      if (bundledPath && fs.existsSync(bundledPath)) {
        return bundledPath;
      }
    } catch (err) {}
  }

  const commonPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  return commonPaths.find((candidate) => fs.existsSync(candidate)) || null;
}

async function captureAwardsCardJpg(matchId, adminToken) {
  if (!adminToken) {
    throw new Error("Sessao de admin ausente para exportar a imagem.");
  }

  const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`;
  return renderImageFromUrl({
    url: `${baseUrl}/admin/matches/${matchId}/awards?export=1`,
    selector: "#awards-card",
    width: 720,
    height: 1280,
    type: "jpeg",
    quality: 88,
    logPrefix: "[share:awards]",
    cookies: [{
      name: "adminToken",
      value: adminToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    }],
  });
}

const captureAwardsCardPng = captureAwardsCardJpg;

async function renderPdfBufferFromHtml(html) {
  if (!puppeteer) {
    puppeteer = require("puppeteer");
  }

  const executablePath = resolveBrowserExecutablePath();
  const browser = await puppeteer.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--font-render-hinting=medium",
      "--force-color-profile=srgb",
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: 1240,
      height: 1754,
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.emulateMediaType("screen");
    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch (err) {}
      }
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: "12mm",
        right: "10mm",
        bottom: "12mm",
        left: "10mm",
      },
    });
    return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

async function sendAdminPdfReport(res, report) {
  const players = await prisma.player.findMany({
    select: {
      id: true,
      name: true,
      nickname: true,
      position: true,
      totalMatches: true,
      totalGoals: true,
      totalAssists: true,
      totalPhotos: true,
      totalRating: true,
    },
    orderBy: { name: "asc" },
  });

  const rows = buildAdminPdfRows(report, players);
  const generatedAt = new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
  });

  const html = await ejs.renderFile(
    path.resolve(__dirname, "..", "..", "views", "admin_report_pdf.ejs"),
    {
      report,
      rows,
      generatedAt,
    },
    { async: true }
  );

  const pdfBuffer = await renderPdfBufferFromHtml(html);
  const stampParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const stampMap = Object.fromEntries(
    stampParts
      .filter((part) => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
      .map((part) => [part.type, part.value])
  );
  const stampedFilename = report.filename.replace(
    /\.pdf$/i,
    `-${stampMap.year}${stampMap.month}${stampMap.day}-${stampMap.hour}${stampMap.minute}${stampMap.second}.pdf`
  );
  res.removeHeader("Content-Type");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${stampedFilename}"`);
  res.setHeader("Content-Length", String(pdfBuffer.length));
  return res.end(pdfBuffer);
}

// ==============================
// PDF report routes
// ==============================

router.get("/reports/pdf", requireAdmin, async (req, res) => {
  try {
    const report = resolveAdminPdfGeneratorSelection(req.query.reportKey || "attendance", req.query.limit);
    if (!report) {
      return res.status(404).send("Relatório não encontrado.");
    }

    return await sendAdminPdfReport(res, report);
  } catch (err) {
    console.error("Erro ao gerar relatório em PDF:", err);
    return res.status(500).send("Não foi possível gerar o PDF agora.");
  }
});

router.get("/reports/pdf/:reportKey", requireAdmin, async (req, res) => {
  try {
    const report = resolveAdminPdfGeneratorSelection(req.params.reportKey, req.query.limit);
    if (!report) {
      return res.status(404).send("Relatório não encontrado.");
    }

    return await sendAdminPdfReport(res, report);
  } catch (err) {
    console.error("Erro ao gerar relatório em PDF:", err);
    return res.status(500).send("Não foi possível gerar o PDF agora.");
  }
});

module.exports = {
  router,
  captureAwardsCardPng,
  captureAwardsCardJpg,
  getAdminPdfReportsList,
  getAdminPdfGeneratorOptions,
  ADMIN_PDF_LIMIT_OPTIONS,
};
