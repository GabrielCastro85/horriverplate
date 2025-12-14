const path = require("path");
const ejs = require("ejs");
const puppeteer = require("puppeteer");

const BASE_URL =
  process.env.APP_BASE_URL ||
  process.env.PUBLIC_URL ||
  `http://localhost:${process.env.PORT || 3000}`;

const FORMATS = {
  story: { width: 1080, height: 1920 },
  feed: { width: 1080, height: 1350 },
};

async function renderSharePng({ templateName, data, format = "story" }) {
  const viewport = FORMATS[format] || FORMATS.story;
  const templatePath = path.join(__dirname, "..", "views", templateName);
  const html = await ejs.renderFile(templatePath, { ...data, BASE_URL }, { async: true });

  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath?.();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", baseURL: BASE_URL });
    const buffer = await page.screenshot({ type: "png" });
    // Garantimos Buffer Node nativo (evita serializaçăo como JSON em alguns runtimes).
    return Buffer.from(buffer);
  } finally {
    await browser.close();
  }
}

module.exports = { renderSharePng, FORMATS };
