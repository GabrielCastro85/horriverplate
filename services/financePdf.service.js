const fs = require("fs");
const path = require("path");
const ejs = require("ejs");

let puppeteer = null;

const VIEW_ROOT = path.resolve(__dirname, "..", "views");
const PDF_TEMPLATE_MAP = Object.freeze({
  finance_report: {
    templatePath: path.resolve(VIEW_ROOT, "pdf", "finance_report.ejs"),
    views: [VIEW_ROOT],
  },
});

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

async function ensurePuppeteer() {
  if (!puppeteer) {
    puppeteer = require("puppeteer");
  }

  return puppeteer;
}

async function renderTemplateHtml(templatePath, data, ejsOptions = {}) {
  return ejs.renderFile(templatePath, data, ejsOptions);
}

function resolvePdfDocument(document) {
  if (!document || typeof document !== "object") {
    throw new Error("PDF document payload is required");
  }

  if (document.templatePath) {
    return {
      templatePath: document.templatePath,
      views: document.views || [VIEW_ROOT],
      data: document.data || {},
    };
  }

  const templateMeta = PDF_TEMPLATE_MAP[document.templateKey];
  if (!templateMeta) {
    throw new Error(`Unknown PDF template: ${document.templateKey || "undefined"}`);
  }

  return {
    templatePath: templateMeta.templatePath,
    views: templateMeta.views,
    data: document.data || {},
  };
}

async function renderDocumentHtml(document) {
  const resolved = resolvePdfDocument(document);
  return renderTemplateHtml(resolved.templatePath, resolved.data, {
    views: resolved.views,
  });
}

async function renderPdfBufferFromHtml(html, options = {}) {
  await ensurePuppeteer();

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

      const images = Array.from(document.images || []);
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve();
            };
            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
            setTimeout(finish, 5000);
          });
        })
      );
    });

    const pdfBytes = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: {
        top: options.marginTop || "12mm",
        right: options.marginRight || "10mm",
        bottom: options.marginBottom || "12mm",
        left: options.marginLeft || "10mm",
      },
    });

    return Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes);
  } finally {
    await browser.close();
  }
}

async function renderDocumentPdfBuffer(document, options = {}) {
  const html = await renderDocumentHtml(document);
  return renderPdfBufferFromHtml(html, options);
}

async function renderFinanceReportHtml(reportPayload) {
  const document = reportPayload?.pdf || {
    templateKey: "finance_report",
    data: reportPayload?.pdfData || {},
  };

  return renderDocumentHtml(document);
}

async function renderFinanceReportPdfBuffer(reportPayload, options = {}) {
  const document = reportPayload?.pdf || {
    templateKey: "finance_report",
    data: reportPayload?.pdfData || {},
  };

  return renderDocumentPdfBuffer(document, options);
}

module.exports = {
  renderTemplateHtml,
  renderDocumentHtml,
  renderPdfBufferFromHtml,
  renderDocumentPdfBuffer,
  renderFinanceReportHtml,
  renderFinanceReportPdfBuffer,
  resolveBrowserExecutablePath,
};
