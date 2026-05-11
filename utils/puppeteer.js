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
  "--disable-component-update",
  "--disable-domain-reliability",
  "--disable-features=AcceptCHFrame,BackForwardCache,MediaRouter,OptimizationHints,Translate",
  "--disable-renderer-backgrounding",
  "--disable-software-rasterizer",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
];

let browserPromise = null;
let imageQueue = Promise.resolve();
let browserIdleTimer = null;

const BROWSER_IDLE_TIMEOUT_MS = Number.parseInt(
  process.env.PUPPETEER_IDLE_TIMEOUT_MS || "3000",
  10
);
const KEEP_BROWSER_ALIVE = process.env.PUPPETEER_KEEP_BROWSER_ALIVE === "1";

function clearBrowserIdleTimer() {
  if (!browserIdleTimer) return;
  clearTimeout(browserIdleTimer);
  browserIdleTimer = null;
}

function scheduleBrowserIdleClose(logPrefix = "[share:image]") {
  if (KEEP_BROWSER_ALIVE || BROWSER_IDLE_TIMEOUT_MS <= 0) return;
  clearBrowserIdleTimer();

  browserIdleTimer = setTimeout(async () => {
    const currentBrowserPromise = browserPromise;
    browserPromise = null;
    browserIdleTimer = null;

    if (!currentBrowserPromise) return;
    try {
      const browser = await currentBrowserPromise;
      if (browser.isConnected()) await browser.close();
      console.log(`${logPrefix} browser closed after idle ${BROWSER_IDLE_TIMEOUT_MS}ms`);
      console.log(`${logPrefix} memory idle ${formatMemoryUsage()}`);
    } catch (err) {
      console.warn(`${logPrefix} browser idle close failed:`, err.message);
    }
  }, BROWSER_IDLE_TIMEOUT_MS);

  if (typeof browserIdleTimer.unref === "function") browserIdleTimer.unref();
}

async function getBrowser() {
  clearBrowserIdleTimer();

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
  clearBrowserIdleTimer();
  const currentBrowserPromise = browserPromise;
  browserPromise = null;
  if (currentBrowserPromise) {
    currentBrowserPromise
      .then((browser) => browser.close().catch(() => {}))
      .catch(() => {});
  }
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
  scaleToWidth = null,
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
      scheduleBrowserIdleClose(logPrefix);
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
