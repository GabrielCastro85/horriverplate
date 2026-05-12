// routes/admin.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { scheduleBackup } = require("../utils/backup");
const { formatDateBR } = require("../utils/finance");
const { formatMonthYearBR, formatPlayerLabel, formatMatchLabel } = require("../utils/adminFormat");
const {
  router: reportsRouter,
  getAdminPdfReportsList,
  getAdminPdfGeneratorOptions,
  ADMIN_PDF_LIMIT_OPTIONS,
} = require("./admin/reports");

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

function sanitizeAuditPayload(input) {
  const MAX_STRING = 300;
  const MAX_ARRAY = 50;
  const MAX_OBJECT_KEYS = 120;
  const SENSITIVE_KEYS = ["password", "senha", "token", "admintoken", "_csrf", "csrf"];

  const trimString = (value) => {
    if (typeof value !== "string") return value;
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  };

  const walk = (value, depth = 0) => {
    if (value == null) return value;
    if (typeof value === "string") return trimString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      return value.slice(0, MAX_ARRAY).map((item) => walk(item, depth + 1));
    }
    if (typeof value === "object") {
      if (depth > 2) return "[obj]";
      const out = {};
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .forEach(([key, val]) => {
          if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) return;
          out[key] = walk(val, depth + 1);
        });
      return out;
    }
    return String(value);
  };

  return walk(input);
}

function countBodyKeys(body, prefix, valueCheck = null) {
  if (!body || typeof body !== "object") return 0;
  return Object.entries(body).filter(([key, value]) => {
    if (!key.startsWith(prefix)) return false;
    if (typeof valueCheck === "function") return valueCheck(value);
    return true;
  }).length;
}

function hasMeaningfulData(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

async function buildAuditMetadata(req) {
  const path = req.path || "";
  const method = req.method || "POST";
  const body = req.body || {};

  const meta = {
    action: path,
    summary: `${method} ${path}`,
    context: {},
    includePayload: true,
  };

  let m = null;

  const getPlayer = async (id) => {
    if (!Number.isFinite(id)) return null;
    return prisma.player.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        nickname: true,
        position: true,
        whatsapp: true,
      },
    });
  };

  const getMatch = async (id) => {
    if (!Number.isFinite(id)) return null;
    return prisma.match.findUnique({
      where: { id },
      select: {
        id: true,
        playedAt: true,
        description: true,
        winnerTeam: true,
        winnerColor: true,
      },
    });
  };

  if (path === "/senha") {
    meta.action = "admin.password.change";
    meta.summary = "Admin alterou a propria senha.";
    meta.includePayload = false;
    return meta;
  }

  if (path === "/players") {
    const name = body.name ? String(body.name).trim() : "";
    const position = body.position ? String(body.position).trim() : "";
    meta.action = "player.create";
    meta.summary = `Admin criou jogador ${name || "(sem nome)"}${position ? ` (${position})` : ""}.`;
    meta.context = {
      playerInput: {
        name: name || null,
        nickname: body.nickname || null,
        position: position || null,
      },
    };
    return meta;
  }

  m = path.match(/^\/players\/(\d+)\/edit$/);
  if (m) {
    const id = Number(m[1]);
    const before = await getPlayer(id);
    const newName = body.name ? String(body.name).trim() : null;
    meta.action = "player.update";
    meta.summary = `Admin editou jogador ${formatPlayerLabel(before, id)}${newName && before && newName !== before.name ? ` -> ${newName}` : ""}.`;
    meta.context = {
      playerId: id,
      before,
    };
    return meta;
  }

  m = path.match(/^\/players\/(\d+)\/delete$/);
  if (m) {
    const id = Number(m[1]);
    const before = await getPlayer(id);
    meta.action = "player.delete";
    meta.summary = `Admin excluiu jogador ${formatPlayerLabel(before, id)}.`;
    meta.context = {
      playerId: id,
      before,
    };
    meta.includePayload = false;
    return meta;
  }

  if (path === "/matches") {
    const played = formatDateBR(body.playedAt || body.playedDate);
    const description = body.description ? String(body.description).trim() : "";
    meta.action = "match.create";
    meta.summary = `Admin criou pelada ${played || "sem data"}${description ? ` - ${description}` : ""}.`;
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/edit$/);
  if (m) {
    const id = Number(m[1]);
    const before = await getMatch(id);
    meta.action = "match.update";
    meta.summary = `Admin editou pelada ${formatMatchLabel(before, id)}.`;
    meta.context = {
      matchId: id,
      before,
    };
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/delete$/);
  if (m) {
    const id = Number(m[1]);
    const before = await getMatch(id);
    meta.action = "match.delete";
    meta.summary = `Admin excluiu pelada ${formatMatchLabel(before, id)}.`;
    meta.context = {
      matchId: id,
      before,
    };
    meta.includePayload = false;
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/stats\/bulk$/);
  if (m) {
    const id = Number(m[1]);
    const match = await getMatch(id);
    const presentCount = countBodyKeys(body, "present_");
    const goalsCount = countBodyKeys(body, "goals_", (v) => String(v || "").trim() !== "" && Number(v) > 0);
    const assistsCount = countBodyKeys(body, "assists_", (v) => String(v || "").trim() !== "" && Number(v) > 0);
    const ratingsCount = countBodyKeys(body, "rating_", (v) => String(v || "").trim() !== "");
    const photosCount = countBodyKeys(body, "photo_");
    meta.action = "match.stats.bulk";
    meta.summary = `Admin atualizou estatísticas da pelada ${formatMatchLabel(match, id)} (presentes: ${presentCount}).`;
    meta.context = {
      matchId: id,
      metrics: {
        presentesMarcados: presentCount,
        golsInformados: goalsCount,
        assistênciasInformadas: assistsCount,
        notasInformadas: ratingsCount,
        fotosMarcadas: photosCount,
      },
    };
    meta.includePayload = false;
    return meta;
  }

  if (path === "/weekly-awards") {
    const weekLabel = formatDateBR(body.weekStart);
    const bestId = body.bestPlayerId && String(body.bestPlayerId).trim() !== "" ? Number(body.bestPlayerId) : null;
    const bestPlayer = bestId ? await getPlayer(bestId) : null;
    meta.action = "weekly_award.upsert";
    meta.summary = `Admin salvou destaque semanal${weekLabel ? ` (${weekLabel})` : ""}${bestPlayer ? ` - craque: ${formatPlayerLabel(bestPlayer)}` : ""}.`;
    meta.context = {
      weekStart: weekLabel || null,
      bestPlayer: bestPlayer ? { id: bestPlayer.id, name: bestPlayer.name } : null,
      winningMatchId: body.winningMatchId ? Number(body.winningMatchId) : null,
    };
    return meta;
  }

  m = path.match(/^\/weekly-awards\/(\d+)\/delete$/);
  if (m) {
    const id = Number(m[1]);
    const award = await prisma.weeklyAward.findUnique({
      where: { id },
      include: {
        bestPlayer: { select: { id: true, name: true, nickname: true } },
      },
    });
    const weekLabel = award ? formatDateBR(award.weekStart) : null;
    meta.action = "weekly_award.delete";
    meta.summary = `Admin excluiu destaque semanal${weekLabel ? ` (${weekLabel})` : ""}${award?.bestPlayer ? ` - ${formatPlayerLabel(award.bestPlayer)}` : ""}.`;
    meta.context = { weeklyAwardId: id, before: sanitizeAuditPayload(award || {}) };
    meta.includePayload = false;
    return meta;
  }

  if (path === "/monthly-awards") {
    const month = Number(body.month);
    const year = Number(body.year);
    const craqueId = body.craqueId && String(body.craqueId).trim() !== "" ? Number(body.craqueId) : null;
    const craque = craqueId ? await getPlayer(craqueId) : null;
    meta.action = "monthly_award.upsert";
    meta.summary = `Admin salvou craque do mês${formatMonthYearBR(month, year) ? ` ${formatMonthYearBR(month, year)}` : ""}${craque ? ` - ${formatPlayerLabel(craque)}` : ""}.`;
    meta.context = {
      month: Number.isFinite(month) ? month : null,
      year: Number.isFinite(year) ? year : null,
      craque: craque ? { id: craque.id, name: craque.name } : null,
    };
    return meta;
  }

  m = path.match(/^\/monthly-awards\/(\d+)\/delete$/);
  if (m) {
    const id = Number(m[1]);
    const award = await prisma.monthlyAward.findUnique({
      where: { id },
      include: {
        craque: { select: { id: true, name: true, nickname: true } },
      },
    });
    const monthYear = award ? formatMonthYearBR(award.month, award.year) : null;
    meta.action = "monthly_award.delete";
    meta.summary = `Admin excluiu premio mensal${monthYear ? ` ${monthYear}` : ""}${award?.craque ? ` - ${formatPlayerLabel(award.craque)}` : ""}.`;
    meta.context = { monthlyAwardId: id, before: sanitizeAuditPayload(award || {}) };
    meta.includePayload = false;
    return meta;
  }

  if (path === "/season-awards") {
    const year = Number(body.year);
    const category = body.category ? String(body.category) : "";
    const playerId = body.playerId && String(body.playerId).trim() !== "" ? Number(body.playerId) : null;
    const player = playerId ? await getPlayer(playerId) : null;
    meta.action = "season_award.upsert";
    meta.summary = `Admin salvou premio de temporada${category ? ` ${category}` : ""}${Number.isFinite(year) ? ` (${year})` : ""}${player ? ` - ${formatPlayerLabel(player)}` : ""}.`;
    meta.context = {
      year: Number.isFinite(year) ? year : null,
      category: category || null,
      player: player ? { id: player.id, name: player.name } : null,
    };
    return meta;
  }

  m = path.match(/^\/season-awards\/(\d+)\/delete$/);
  if (m) {
    const id = Number(m[1]);
    const award = await prisma.seasonAward.findUnique({
      where: { id },
      include: {
        player: { select: { id: true, name: true, nickname: true } },
      },
    });
    meta.action = "season_award.delete";
    meta.summary = `Admin excluiu premio de temporada${award ? ` ${award.category} (${award.year})` : ""}${award?.player ? ` - ${formatPlayerLabel(award.player)}` : ""}.`;
    meta.context = { seasonAwardId: id, before: sanitizeAuditPayload(award || {}) };
    meta.includePayload = false;
    return meta;
  }

  if (path === "/monthly-vote-session") {
    const month = Number(body.month);
    const year = Number(body.year);
    meta.action = "monthly_vote_session.upsert";
    meta.summary = `Admin gerou votacao do mês${formatMonthYearBR(month, year) ? ` ${formatMonthYearBR(month, year)}` : ""}.`;
    return meta;
  }

  m = path.match(/^\/monthly-vote\/(\d+)\/close$/);
  if (m) {
    meta.action = "monthly_vote_session.close";
    meta.summary = `Admin encerrou votacao do mês #${Number(m[1])}.`;
    meta.includePayload = false;
    return meta;
  }

  m = path.match(/^\/monthly-vote\/(\d+)\/delete$/);
  if (m) {
    meta.action = "monthly_vote_session.delete";
    meta.summary = `Admin excluiu votacao do mês #${Number(m[1])}.`;
    meta.includePayload = false;
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/votes\/(\d+)\/delete$/);
  if (m) {
    const matchId = Number(m[1]);
    const ballotId = Number(m[2]);
    const ballot = await prisma.voteBallot.findUnique({
      where: { id: ballotId },
      include: {
        token: {
          include: {
            player: { select: { id: true, name: true, nickname: true } },
            session: {
              include: {
                match: { select: { id: true, playedAt: true, description: true } },
              },
            },
          },
        },
      },
    });
    meta.action = "match_vote.delete";
    meta.summary = `Admin excluiu voto da pelada ${formatMatchLabel(ballot?.token?.session?.match, matchId)}${ballot?.token?.player ? ` - ${formatPlayerLabel(ballot.token.player)}` : ""}.`;
    meta.context = {
      matchId,
      voteBallotId: ballotId,
      voter: ballot?.token?.player
        ? { id: ballot.token.player.id, name: ballot.token.player.name }
        : null,
      before: ballot
        ? {
            id: ballot.id,
            createdAt: ballot.createdAt,
            voteTokenId: ballot.voteTokenId,
          }
        : null,
    };
    meta.includePayload = false;
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/sort-teams$/);
  if (m) {
    const id = Number(m[1]);
    const match = await getMatch(id);
    const presentIds = Array.isArray(body.presentIds) ? body.presentIds.length : 0;
    const seedIds = Array.isArray(body.seedIds) ? body.seedIds.length : 0;
    meta.action = "lineup.sort";
    meta.summary = `Admin sorteou times da pelada ${formatMatchLabel(match, id)}.`;
    meta.context = {
      matchId: id,
      presentIdsCount: presentIds,
      seedIdsCount: seedIds,
    };
    return meta;
  }

  m = path.match(/^\/matches\/(\d+)\/save-lineup$/);
  if (m) {
    const id = Number(m[1]);
    const match = await getMatch(id);
    const teams = Array.isArray(body.teams) ? body.teams.length : 0;
    meta.action = "lineup.save";
    meta.summary = `Admin salvou times da pelada ${formatMatchLabel(match, id)}.`;
    meta.context = { matchId: id, teamCount: teams, source: body.source || null };
    return meta;
  }

  if (path === "/recalculate-overall") {
    meta.action = "overall.recalculate";
    meta.summary = "Admin recalculou overall de todos os jogadores.";
    meta.includePayload = false;
    return meta;
  }

  if (path === "/recalculate-totals") {
    meta.action = "player_totals.recalculate";
    meta.summary = "Admin recalculou totais de todos os jogadores.";
    meta.includePayload = false;
    return meta;
  }

  return meta;
}

// ==============================
// Auditoria: loga ações de mutação
// ==============================
router.use((req, res, next) => {
  if (!req.admin) return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const cleanPath = (req.originalUrl || req.path || "").split("?")[0];

  buildAuditMetadata(req)
    .then((meta) => {
      const payloadDetails = meta.includePayload ? sanitizeAuditPayload(req.body || {}) : null;
      const contextDetails = sanitizeAuditPayload(meta.context || {});

      let details = null;
      if (hasMeaningfulData(payloadDetails) || hasMeaningfulData(contextDetails)) {
        details = {};
        if (hasMeaningfulData(payloadDetails)) details.payload = payloadDetails;
        if (hasMeaningfulData(contextDetails)) details.context = contextDetails;
      }

      const auditData = {
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        method: req.method,
        path: cleanPath,
        action: meta.action || req.path,
        summary: meta.summary || `${req.method} ${cleanPath}`,
        details,
      };

      res.on("finish", async () => {
        if (res.statusCode >= 400) return;
        try {
          await prisma.auditLog.create({ data: auditData });
        } catch (err) {
          console.warn("Falha ao gravar auditoria:", err && err.message ? err.message : err);
        }
      });
    })
    .catch((err) => {
      console.warn("Falha ao montar auditoria:", err && err.message ? err.message : err);
      const fallbackData = {
        adminId: req.admin.id,
        adminEmail: req.admin.email,
        method: req.method,
        path: cleanPath,
        action: req.path,
        summary: `${req.method} ${cleanPath}`,
        details: sanitizeAuditPayload(req.body || {}),
      };
      res.on("finish", async () => {
        if (res.statusCode >= 400) return;
        try {
          await prisma.auditLog.create({ data: fallbackData });
        } catch (persistErr) {
          console.warn(
            "Falha ao gravar auditoria:",
            persistErr && persistErr.message ? persistErr.message : persistErr
          );
        }
      });
    })
    .finally(() => next());
});

// ==============================
// Backup: agenda após mutações bem-sucedidas
// ==============================
router.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD") return next();
  res.on("finish", () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      scheduleBackup({ reason: `${req.method} ${req.originalUrl}` });
    }
  });
  next();
});

// ==============================
// Dashboard /admin
// ==============================
router.get("/", requireAdmin, async (req, res) => {
  try {
    const matches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
      take: 120,
    });

    const groupedMatchesObj = matches.reduce((groups, match) => {
      const date = new Date(match.playedAt);
      const year = date.getFullYear();
      const month = date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" });
      const key = `${month} ${year}`;

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(match);
      return groups;
    }, {});

    const groupedMatches = Object.entries(groupedMatchesObj).map(
      ([key, matchesInGroup]) => ({
        group: key,
        matches: matchesInGroup,
      })
    );

    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    const weeklyAwards = await prisma.weeklyAward.findMany({
      orderBy: { weekStart: "desc" },
      take: 5,
      include: {
        bestPlayer: true,
        winningMatch: true,
      },
    });

    const monthlyAwards = await prisma.monthlyAward.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 6,
      include: {
        craque: true,
      },
    });

    const seasonAwards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    const latestMatch = matches && matches.length ? matches[0] : null;
    const referenceDate = latestMatch ? new Date(latestMatch.playedAt) : new Date();
    const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);

    const monthStats = await prisma.playerStat.findMany({
      where: {
        match: {
          playedAt: {
            gte: monthStart,
            lt: monthEnd,
          },
        },
      },
      include: {
        player: true,
      },
    });

    const monthAgg = new Map();
    monthStats.forEach((stat) => {
      const id = stat.playerId;
      if (!monthAgg.has(id)) {
        monthAgg.set(id, {
          player: stat.player,
          goals: 0,
          assists: 0,
          ratingSum: 0,
          ratingCount: 0,
        });
      }
      const entry = monthAgg.get(id);
      entry.goals += stat.goals || 0;
      entry.assists += stat.assists || 0;
      if (stat.rating != null) {
        entry.ratingSum += stat.rating;
        entry.ratingCount += 1;
      }
    });

    const monthRows = Array.from(monthAgg.values()).map((row) => ({
      player: row.player,
      goals: row.goals,
      assists: row.assists,
      avgRating: row.ratingCount ? row.ratingSum / row.ratingCount : null,
    }));

    const monthTopGoals = [...monthRows].sort((a, b) => b.goals - a.goals).slice(0, 5);
    const monthTopAssists = [...monthRows].sort((a, b) => b.assists - a.assists).slice(0, 5);
    const monthTopRatings = monthRows
      .filter((row) => row.avgRating != null)
      .sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0))
      .slice(0, 5);

    const monthNames = [
      "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    ];
    const monthLabel = `${monthNames[referenceDate.getMonth()]} ${referenceDate.getFullYear()}`;

    res.render("admin", {
      title: "Painel do Admin",
      matches,
      groupedMatches,
      players,
      weeklyAwards,
      monthlyAwards,
      seasonAwards,
      monthTopGoals,
      monthTopAssists,
      monthTopRatings,
      monthLabel,
      pdfReports: getAdminPdfReportsList(),
      pdfGeneratorReports: getAdminPdfGeneratorOptions(),
      pdfLimitOptions: ADMIN_PDF_LIMIT_OPTIONS,
    });
  } catch (err) {
    console.error("Erro ao carregar painel admin:", err);
    res.status(500).send("Erro ao carregar painel do admin.");
  }
});

// ==============================
// Sub-routers por domínio
// ==============================
router.use("/", require("./admin/auth"));
router.use("/", require("./admin/players"));
router.use("/", require("./admin/monthly_vote"));
router.use("/", require("./admin/awards"));
router.use("/", require("./admin/matches"));
router.use("/", require("./admin/restore"));
router.use("/", reportsRouter);

module.exports = router;
