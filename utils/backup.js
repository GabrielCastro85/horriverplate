const fs = require("fs");
const path = require("path");
const prisma = require("./db");

const BACKUP_DIR = path.join(__dirname, "..", "backups");
const LATEST_PATH = path.join(BACKUP_DIR, "backup-latest.json");
const MAX_BACKUPS = 10;
const MIN_INTERVAL_MS = 60 * 1000;

let lastRun = 0;
let running = false;
let scheduled = null;

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    now.getFullYear() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

async function buildSnapshot(reason) {
  const [
    admins,
    players,
    matches,
    playerStats,
    weeklyAwards,
    monthlyAwards,
    seasonAwards,
    voteSessions,
    voteTokens,
    voteBallots,
    voteRankings,
    voteLinks,
    voteChoices,
    achievements,
    playerAchievements,
    overallHistory,
    lineupDraws,
    tournaments,
    tournamentTeams,
    tournamentGames,
  ] = await Promise.all([
    prisma.admin.findMany(),
    prisma.player.findMany(),
    prisma.match.findMany(),
    prisma.playerStat.findMany(),
    prisma.weeklyAward.findMany(),
    prisma.monthlyAward.findMany(),
    prisma.seasonAward.findMany(),
    prisma.voteSession.findMany(),
    prisma.voteToken.findMany(),
    prisma.voteBallot.findMany(),
    prisma.voteRanking.findMany(),
    prisma.voteLink.findMany(),
    prisma.voteChoice.findMany(),
    prisma.achievement.findMany(),
    prisma.playerAchievement.findMany(),
    prisma.overallHistory.findMany(),
    prisma.lineupDraw.findMany(),
    prisma.tournament.findMany(),
    prisma.tournamentTeam.findMany(),
    prisma.tournamentGame.findMany(),
  ]);

  return {
    createdAt: new Date().toISOString(),
    reason,
    tables: {
      admins,
      players,
      matches,
      playerStats,
      weeklyAwards,
      monthlyAwards,
      seasonAwards,
      voteSessions,
      voteTokens,
      voteBallots,
      voteRankings,
      voteLinks,
      voteChoices,
      achievements,
      playerAchievements,
      overallHistory,
      lineupDraws,
      tournaments,
      tournamentTeams,
      tournamentGames,
    },
  };
}

function pruneBackups() {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith("backup-") && name.endsWith(".json"))
    .filter((name) => name !== "backup-latest.json")
    .map((name) => ({
      name,
      path: path.join(BACKUP_DIR, name),
      stat: fs.statSync(path.join(BACKUP_DIR, name)),
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  files.slice(MAX_BACKUPS).forEach((file) => {
    try {
      fs.unlinkSync(file.path);
    } catch (err) {
      // ignore cleanup errors
    }
  });
}

async function runBackup(reason) {
  if (running) return;
  running = true;
  try {
    ensureDir();
    const snapshot = await buildSnapshot(reason);
    const json = JSON.stringify(snapshot, null, 2);
    const tmpPath = `${LATEST_PATH}.tmp`;
    fs.writeFileSync(tmpPath, json, "utf8");
    fs.renameSync(tmpPath, LATEST_PATH);

    const datedPath = path.join(
      BACKUP_DIR,
      `backup-${getTimestamp()}.json`
    );
    fs.writeFileSync(datedPath, json, "utf8");
    pruneBackups();
  } finally {
    lastRun = Date.now();
    running = false;
  }
}

function scheduleBackup({ reason }) {
  const now = Date.now();
  if (running) return;
  const timeSince = now - lastRun;
  if (timeSince >= MIN_INTERVAL_MS) {
    runBackup(reason).catch(() => {});
    return;
  }
  if (scheduled) return;
  scheduled = setTimeout(() => {
    scheduled = null;
    runBackup(reason).catch(() => {});
  }, MIN_INTERVAL_MS - timeSince);
}

module.exports = {
  scheduleBackup,
};
