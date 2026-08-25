const { execFileSync } = require("child_process");
const path = require("path");

process.env.PUPPETEER_CACHE_DIR =
  process.env.PUPPETEER_CACHE_DIR ||
  path.resolve(__dirname, "..", ".cache", "puppeteer");

const npx = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args) {
  execFileSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
}

run(npx, ["prisma", "generate"]);
run(npx, ["puppeteer", "browsers", "install", "chrome"]);
