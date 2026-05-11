const puppeteer = require("puppeteer");

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--hide-scrollbars",
  "--metrics-recording-only",
  "--mute-audio",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
];

let browserPromise = null;
let imageQueue = Promise.resolve();

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: "new",
        args: PUPPETEER_ARGS,
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }

  const browser = await browserPromise;
  if (!browser.isConnected()) {
    browserPromise = null;
    return getBrowser();
  }

  return browser;
}

function resetBrowser() {
  browserPromise = null;
}

function enqueueImageJob(job) {
  const run = imageQueue.then(job, job);
  imageQueue = run.catch(() => {});
  return run;
}

function formatMemoryUsage(memory = process.memoryUsage()) {
  const toMb = (value) => `${Math.round(value / 1024 / 1024)}mb`;
  return `rss=${toMb(memory.rss)} heap=${toMb(memory.heapUsed)}/${toMb(memory.heapTotal)} external=${toMb(memory.external)}`;
}

function viewportFor(format = "story") {
  if (format === "feed") return { format: "feed", width: 720, height: 900 };
  if (format === "square" || format === "quadrado") return { format: "square", width: 720, height: 720 };
  return { format: "story", width: 720, height: 1280 };
}

async function blockUnneededRequests(page, { allowScripts = false } = {}) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const type = request.resourceType();
    const blocked =
      type === "media" ||
      (!allowScripts && type === "script") ||
      /analytics|googletagmanager|google-analytics|gtag|facebook|pixel|hotjar|clarity|tracking/i.test(url);

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
  type = "jpeg",
  quality = 88,
  logPrefix = "[share:image]",
  cookies = [],
  allowScripts = false,
  waitUntil = "networkidle0",
  timeout = 30000,
}) {
  const t0 = Date.now();
  console.log(`${logPrefix} start ${width}x${height} ${type}`);
  console.log(`${logPrefix} memory before ${formatMemoryUsage()}`);

  return enqueueImageJob(async () => {
    let page;
    try {
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      if (cookies.length) await page.setCookie(...cookies);
      await blockUnneededRequests(page, { allowScripts });

      if (html) {
        await page.setContent(html, { waitUntil, timeout });
      } else if (url) {
        await page.goto(url, { waitUntil, timeout });
      } else {
        throw new Error("HTML ou URL obrigatorio para renderizar imagem.");
      }

      const failedImages = await waitForFontsAndImages(page, { selector });
      if (failedImages.length) {
        console.warn(`${logPrefix} failed images (${failedImages.length}):`, failedImages);
      }

      const target = await page.$(selector);
      if (!target) throw new Error(`Elemento ${selector} nao encontrado.`);

      const screenshotOptions = type === "jpeg"
        ? { type: "jpeg", quality }
        : { type: "png", omitBackground: false };
      const raw = await target.screenshot(screenshotOptions);
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (!buffer.length) throw new Error("Screenshot retornou 0 bytes.");

      console.log(`${logPrefix} generated ${Math.round(buffer.length / 1024)}kb in ${Date.now() - t0}ms`);
      console.log(`${logPrefix} memory after ${formatMemoryUsage()}`);
      return buffer;
    } catch (err) {
      if (/Target closed|Browser closed|disconnected/i.test(err.message || "")) resetBrowser();
      console.error(`${logPrefix} error:`, err);
      throw err;
    } finally {
      if (page) await page.close().catch(() => {});
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
  enqueueImageJob,
  formatMemoryUsage,
  getBrowser,
  renderImageFromHtml,
  renderImageFromUrl,
  resetBrowser,
  viewportFor,
};
