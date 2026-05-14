const fs = require("fs");
const puppeteer = require("puppeteer");

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-zygote",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-translate",
  "--hide-scrollbars",
  "--mute-audio",
];

const DEFAULT_TIMEOUT_MS = clampNumber(
  Number.parseInt(process.env.IMAGE_RENDER_TIMEOUT_MS || "30000", 10),
  5000,
  60000
);
const DEFAULT_DEVICE_SCALE_FACTOR = clampNumber(
  Number.parseFloat(process.env.SHARE_IMAGE_DPR || "1.35"),
  1,
  1.75
);
const DEFAULT_JPEG_QUALITY = clampNumber(
  Number.parseInt(process.env.SHARE_IMAGE_QUALITY || "90", 10),
  80,
  94
);

let imageQueue = Promise.resolve();

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatMemoryUsage(memory = process.memoryUsage()) {
  const toMb = (value) => `${Math.round(value / 1024 / 1024)}mb`;
  return `rss=${toMb(memory.rss)} heap=${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)} external=${toMb(memory.external)}`;
}

function runGarbageCollection(logPrefix) {
  if (typeof global.gc !== "function") return;
  try {
    global.gc();
    console.log(`${logPrefix} gc ${formatMemoryUsage()}`);
  } catch (err) {
    console.warn(`${logPrefix} gc failed:`, err.message);
  }
}

function viewportFor(format = "story") {
  if (format === "feed") return { format: "feed", width: 720, height: 900 };
  if (format === "square" || format === "quadrado") return { format: "square", width: 720, height: 720 };
  return { format: "story", width: 720, height: 1280 };
}

function resolveBrowserExecutablePath() {
  const explicitPaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
  ].filter(Boolean);

  for (const candidate of explicitPaths) {
    if (fs.existsSync(candidate)) return candidate;
  }

  try {
    const bundledPath = puppeteer.executablePath();
    if (bundledPath && fs.existsSync(bundledPath)) return bundledPath;
  } catch (err) {}

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

function enqueueImageJob(job) {
  const run = imageQueue.then(job, job);
  imageQueue = run.catch(() => {});
  return run;
}

function isLocalOrInlineResource(url, origin) {
  if (!url) return true;
  if (/^(data|blob|about):/i.test(url)) return true;
  if (!origin) return false;

  try {
    return new URL(url).origin === origin;
  } catch (err) {
    return false;
  }
}

async function blockUnneededRequests(page, {
  allowScripts = false,
  allowExternalImages = false,
  origin = null,
} = {}) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const type = request.resourceType();
    const isLocal = isLocalOrInlineResource(url, origin);
    const isTracking = /analytics|googletagmanager|google-analytics|gtag|facebook|pixel|hotjar|clarity|tracking/i.test(url);
    const isExternalImage = type === "image" && !allowExternalImages && !isLocal;
    const isExternalFontOrStyle = (type === "font" || type === "stylesheet") && !isLocal;
    const blocked =
      isTracking ||
      type === "media" ||
      (!allowScripts && type === "script") ||
      isExternalImage ||
      isExternalFontOrStyle;

    if (blocked) return request.abort().catch(() => {});
    return request.continue().catch(() => {});
  });
}

async function waitForFontsAndImages(page, { selector = "body", timeout = 5000 } = {}) {
  await Promise.race([
    page.evaluate(() => document.fonts && document.fonts.ready),
    new Promise((resolve) => setTimeout(resolve, timeout)),
  ]);

  return page.evaluate(
    async ({ selector: rootSelector, timeoutMs }) => {
      const root = document.querySelector(rootSelector) || document.body;
      const images = Array.from(root.querySelectorAll("img"));
      await Promise.all(
        images.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const finish = () => resolve();
            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
            setTimeout(finish, timeoutMs);
          });
        })
      );

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      return images
        .filter((img) => img.naturalWidth === 0)
        .map((img) => img.currentSrc || img.src);
    },
    { selector, timeoutMs: timeout }
  );
}

async function renderImageJob({
  html,
  url,
  selector = "body",
  width = 720,
  height = 1280,
  deviceScaleFactor = DEFAULT_DEVICE_SCALE_FACTOR,
  type = "jpeg",
  quality = DEFAULT_JPEG_QUALITY,
  logPrefix = "[image-renderer]",
  cookies = [],
  allowScripts = false,
  allowExternalImages = false,
  resourceOrigin = null,
  scaleToWidth = null,
  waitUntil = "domcontentloaded",
  timeout = DEFAULT_TIMEOUT_MS,
}) {
  const safeWidth = Math.max(320, Math.min(1600, Number(width) || 720));
  const safeHeight = Math.max(320, Math.min(2000, Number(height) || 1280));
  const safeDpr = clampNumber(Number(deviceScaleFactor) || DEFAULT_DEVICE_SCALE_FACTOR, 1, 1.75);
  const safeQuality = clampNumber(Number(quality) || DEFAULT_JPEG_QUALITY, 80, 94);
  const safeTimeout = clampNumber(Number(timeout) || DEFAULT_TIMEOUT_MS, 5000, 60000);
  const outputType = type === "png" ? "png" : "jpeg";
  const origin = url ? new URL(url).origin : resourceOrigin;

  return enqueueImageJob(async () => {
    const t0 = Date.now();
    let browser = null;
    let page = null;
    let timeoutId = null;

    console.log(`${logPrefix} queued`);
    console.log(`${logPrefix} start type=${outputType} viewport=${safeWidth}x${safeHeight} dpr=${safeDpr} q=${safeQuality} timeout=${safeTimeout}ms`);
    console.log(`${logPrefix} memory before ${formatMemoryUsage()}`);

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Tempo limite de ${safeTimeout}ms excedido ao gerar imagem.`));
      }, safeTimeout);
      if (typeof timeoutId.unref === "function") timeoutId.unref();
    });

    const workPromise = (async () => {
      const executablePath = resolveBrowserExecutablePath();
      browser = await puppeteer.launch({
        headless: "new",
        ...(executablePath ? { executablePath } : {}),
        args: PUPPETEER_ARGS,
      });
      page = await browser.newPage();
      page.setDefaultTimeout(safeTimeout);
      page.setDefaultNavigationTimeout(safeTimeout);
      await page.setViewport({ width: safeWidth, height: safeHeight, deviceScaleFactor: safeDpr });
      if (cookies.length) await page.setCookie(...cookies);
      await blockUnneededRequests(page, { allowScripts, allowExternalImages, origin });

      if (html) {
        await page.setContent(html, { waitUntil, timeout: safeTimeout });
      } else if (url) {
        await page.goto(url, { waitUntil, timeout: safeTimeout });
      } else {
        throw new Error("HTML ou URL obrigatorio para renderizar imagem.");
      }

      const failedImages = await waitForFontsAndImages(page, {
        selector,
        timeout: Math.min(5000, Math.max(1500, safeTimeout / 4)),
      });
      if (failedImages.length) {
        console.warn(`${logPrefix} failed images (${failedImages.length}):`, failedImages);
      }

      const target = await page.$(selector);
      if (!target) throw new Error(`Elemento ${selector} nao encontrado.`);

      if (scaleToWidth) {
        const scale = await page.evaluate(
          ({ selector: targetSelector, maxWidth }) => {
            const element = document.querySelector(targetSelector);
            if (!element) return 1;

            const rect = element.getBoundingClientRect();
            if (!rect.width || rect.width <= maxWidth) return 1;

            const nextScale = maxWidth / rect.width;
            document.documentElement.style.width = `${maxWidth}px`;
            document.body.style.width = `${maxWidth}px`;
            document.body.style.minWidth = `${maxWidth}px`;
            element.style.transform = `scale(${nextScale})`;
            element.style.transformOrigin = "top left";
            element.style.willChange = "transform";
            return nextScale;
          },
          { selector, maxWidth: scaleToWidth }
        );
        console.log(`${logPrefix} scale ${scale.toFixed(3)} to width ${scaleToWidth}`);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }

      const screenshotOptions = outputType === "jpeg"
        ? { type: "jpeg", quality: safeQuality, optimizeForSpeed: false }
        : { type: "png", omitBackground: false };
      const raw = await target.screenshot(screenshotOptions);
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (!buffer.length) throw new Error("Screenshot retornou 0 bytes.");

      console.log(`${logPrefix} success bytes=${buffer.length} kb=${Math.round(buffer.length / 1024)} time=${Date.now() - t0}ms`);
      return buffer;
    })();

    try {
      return await Promise.race([workPromise, timeoutPromise]);
    } catch (err) {
      console.error(`${logPrefix} error:`, err);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (page) {
        await page.close().catch((err) => console.warn(`${logPrefix} page close failed:`, err.message));
        page = null;
      }
      if (browser) {
        await browser.close().catch((err) => console.warn(`${logPrefix} browser close failed:`, err.message));
        browser = null;
      }
      console.log(`${logPrefix} memory after ${formatMemoryUsage()}`);
      runGarbageCollection(logPrefix);
    }
  });
}

function renderImageFromHtml(options) {
  return renderImageJob(options);
}

function renderImageFromUrl(options) {
  return renderImageJob(options);
}

module.exports = {
  PUPPETEER_ARGS,
  enqueueImageJob,
  formatMemoryUsage,
  renderImageFromHtml,
  renderImageFromUrl,
  resolveBrowserExecutablePath,
  viewportFor,
};
