// routes/admin.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../utils/db");
const bcrypt = require("bcryptjs");
const { scheduleBackup } = require("../utils/backup");
const {
  uploadPlayerPhoto,
  uploadWeeklyTeamPhoto,
} = require("../utils/upload");

const { computeOverallFromEntries } = require("../utils/overall");
const { rebuildAchievementsForAllPlayers } = require("../utils/achievements");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");

// ==============================
// ??? Middleware: exige admin logado
// ==============================
function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.redirect("/login");
  }
  next();
}

const MONTHLY_VOTE_WEIGHTS = {
  goals: 0.3,
  assists: 0.2,
  rating: 0.5,
};
const MONTHLY_VOTE_MIN_MATCHES = 2;

function getMonthRange(year, month) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

async function computeMonthlyVoteData(month, year) {
  const { start, end } = getMonthRange(year, month);
  const stats = await prisma.playerStat.findMany({
    where: {
      present: true,
      match: { playedAt: { gte: start, lt: end } },
    },
    include: { player: true },
  });

  const agg = new Map();
  stats.forEach((stat) => {
    if (!agg.has(stat.playerId)) {
      agg.set(stat.playerId, {
        player: stat.player,
        matches: 0,
        goals: 0,
        assists: 0,
        ratingSum: 0,
        ratingCount: 0,
        photos: 0,
      });
    }
    const row = agg.get(stat.playerId);
    row.matches += 1;
    row.goals += stat.goals || 0;
    row.assists += stat.assists || 0;
    row.photos += stat.appearedInPhoto ? 1 : 0;
    if (stat.rating != null) {
      row.ratingSum += stat.rating;
      row.ratingCount += 1;
    }
  });

  const allRows = Array.from(agg.values()).map((row) => {
    const avgGoals = row.matches ? row.goals / row.matches : 0;
    const avgAssists = row.matches ? row.assists / row.matches : 0;
    const avgRating = row.ratingCount ? row.ratingSum / row.ratingCount : 0;
    const score =
      avgGoals * MONTHLY_VOTE_WEIGHTS.goals +
      avgAssists * MONTHLY_VOTE_WEIGHTS.assists +
      avgRating * MONTHLY_VOTE_WEIGHTS.rating;
    return {
      player: row.player,
      matches: row.matches,
      goals: row.goals,
      assists: row.assists,
      photos: row.photos,
      avgGoals,
      avgAssists,
      avgRating,
      score,
    };
  });

  const eligibleVoters = allRows.map((r) => r.player.id);
  const candidates = allRows
    .filter((r) => r.matches >= MONTHLY_VOTE_MIN_MATCHES)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((r) => ({
      id: r.player.id,
      name: r.player.name,
      nickname: r.player.nickname || null,
      photoUrl: r.player.photoUrl || null,
      matches: r.matches,
      goals: r.goals,
      assists: r.assists,
      photos: r.photos,
      avgGoals: Number(r.avgGoals.toFixed(2)),
      avgAssists: Number(r.avgAssists.toFixed(2)),
      avgRating: Number(r.avgRating.toFixed(2)),
      score: Number(r.score.toFixed(4)),
    }));

  return { candidates, eligibleVoters };
}

function sanitizeAuditPayload(input) {
  const MAX_STRING = 300;
  const MAX_ARRAY = 50;
  const SENSITIVE_KEYS = ["password", "senha", "token", "adminToken"];

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
      Object.entries(value).forEach(([key, val]) => {
        if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) return;
        out[key] = walk(val, depth + 1);
      });
      return out;
    }
    return String(value);
  };

  return walk(input);
}

// ==============================
// ?? Auditoria: loga a––es de muta––o
// ==============================
router.use((req, res, next) => {
  if (!req.admin) return next();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();

  const auditData = {
    adminId: req.admin.id,
    adminEmail: req.admin.email,
    method: req.method,
    path: req.originalUrl,
    action: req.path,
    summary: `${req.method} ${req.originalUrl}`,
    details: sanitizeAuditPayload(req.body || {}),
  };

  res.on("finish", async () => {
    if (res.statusCode >= 400) return;
    try {
      await prisma.auditLog.create({ data: auditData });
    } catch (err) {
      console.warn("Falha ao gravar auditoria:", err && err.message ? err.message : err);
    }
  });

  next();
});

// ==============================
// ?? Trocar senha do admin logado
// ==============================
router.get("/senha", requireAdmin, (req, res) => {
  res.render("admin_password", {
    title: "Trocar senha",
    error: null,
    success: req.query.success === "1",
  });
});

router.post("/senha", requireAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "Preencha todos os campos.",
        success: false,
      });
    }

    if (newPassword.length < 6) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "A nova senha deve ter pelo menos 6 caracteres.",
        success: false,
      });
    }

    if (newPassword !== confirmPassword) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "A confirma––o da senha não confere.",
        success: false,
      });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
    if (!admin) {
      return res.redirect("/login");
    }

    const ok = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!ok) {
      return res.render("admin_password", {
        title: "Trocar senha",
        error: "Senha atual incorreta.",
        success: false,
      });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.admin.update({
      where: { id: admin.id },
      data: { passwordHash },
    });

    return res.redirect("/admin/senha?success=1");
  } catch (err) {
    console.error("Erro ao trocar senha:", err);
    return res.render("admin_password", {
      title: "Trocar senha",
      error: "Erro ao tentar trocar a senha. Tente novamente.",
      success: false,
    });
  }
});

// ==============================
// ?? Auditoria (apenas admin principal)
// ==============================
router.get("/auditoria", requireAdmin, async (req, res) => {
  try {
    if (!req.admin || req.admin.email !== "admin@horriver.com") {
      return res.redirect("/admin");
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = 50;
    const skip = (page - 1) * pageSize;

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.auditLog.count(),
    ]);

    const totalPages = Math.max(Math.ceil(total / pageSize), 1);

    return res.render("admin_audit", {
      title: "Auditoria",
      logs,
      page,
      totalPages,
      total,
    });
  } catch (err) {
    console.error("Erro ao carregar auditoria:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// ?? Helper: recomputar totais de jogadores (para alguns IDs)
// ==============================
async function recomputeTotalsForPlayers(playerIds) {
  const uniqueIds = Array.from(new Set(playerIds)).filter((id) => !!id);
  if (!uniqueIds.length) return;

  for (const id of uniqueIds) {
    const [stats, player] = await Promise.all([
      prisma.playerStat.findMany({
        where: { playerId: id },
        include: { match: true },
        orderBy: { match: { playedAt: "desc" } },
      }),
      prisma.player.findUnique({ where: { id } }),
    ]);

    let goals = 0;
    let assists = 0;
    let matches = 0;
    let photos = 0;
    let ratingSum = 0;
    let ratingCount = 0;

    for (const s of stats) {
      goals += s.goals || 0;
      assists += s.assists || 0;
      if (s.present) matches++;
      if (s.appearedInPhoto) photos++;
      if (s.rating != null) {
        ratingSum += s.rating;
        ratingCount++;
      }
    }

    const avgRating = ratingCount > 0 ? ratingSum / ratingCount : 0;

    // Overall din–mico: mant–m override manual (se existir), arredondado; não recalcula automaticamente
    const overallDynamic = (player?.overallDynamic != null) ? Math.round(player.overallDynamic) : null;

    await prisma.player.update({
      where: { id },
      data: {
        totalGoals: goals,
        totalAssists: assists,
        totalMatches: matches,
        totalPhotos: photos,
        totalRating: avgRating,
        overallDynamic,
        overallLastUpdated: new Date(),
      },
    });
  }
}

// ==============================
// ?? Painel principal /admin
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

router.get("/", requireAdmin, async (req, res) => {
  try {
    const matches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
    });

    // Agrupa peladas por mês/ano
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

    // Premia––es de temporada (para exibir resuminho se quiser)
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

    const monthTopGoals = [...monthRows]
      .sort((a, b) => b.goals - a.goals)
      .slice(0, 5);
    const monthTopAssists = [...monthRows]
      .sort((a, b) => b.assists - a.assists)
      .slice(0, 5);
    const monthTopRatings = monthRows
      .filter((row) => row.avgRating != null)
      .sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0))
      .slice(0, 5);

    const monthNames = [
      "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
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
    });
  } catch (err) {
    console.error("Erro ao carregar painel admin:", err);
    res.status(500).send("Erro ao carregar painel do admin.");
  }
});

// ==============================
// ??? Votacao do mes (painel separado)
// ==============================
router.get("/monthly-vote", requireAdmin, async (req, res) => {
  try {
    const latestMatch = await prisma.match.findFirst({
      orderBy: { playedAt: "desc" },
    });
    const referenceDate = latestMatch ? new Date(latestMatch.playedAt) : new Date();

    const monthNames = [
      "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
      "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
    ];

    const hasMonthParam = req.query.mvMonth != null;
    const hasYearParam = req.query.mvYear != null;
    let mvMonth = Number(req.query.mvMonth) || referenceDate.getMonth() + 1;
    let mvYear = Number(req.query.mvYear) || referenceDate.getFullYear();

    if (!hasMonthParam && !hasYearParam) {
      const latestSession = await prisma.monthlyVoteSession.findFirst({
        orderBy: { createdAt: "desc" },
      });
      if (latestSession) {
        mvMonth = latestSession.month;
        mvYear = latestSession.year;
      }
    }

    const monthlyVoteSession = await prisma.monthlyVoteSession.findUnique({
      where: { month_year: { month: mvMonth, year: mvYear } },
      include: { tokens: { include: { player: true } } },
    });

    const monthlyVoteTokens = monthlyVoteSession?.tokens
      ? [...monthlyVoteSession.tokens].sort((a, b) => {
          const an = a.player?.name || "";
          const bn = b.player?.name || "";
          return an.localeCompare(bn);
        })
      : [];
    const monthlyVoteCandidates = Array.isArray(monthlyVoteSession?.candidates)
      ? monthlyVoteSession.candidates
      : [];
    const voteBaseUrl = `${req.protocol}://${req.get("host")}`;
    const monthlyVoteBallots = monthlyVoteSession
      ? await prisma.monthlyVoteBallot.findMany({
          where: { token: { sessionId: monthlyVoteSession.id } },
          include: { token: { include: { player: true } }, candidate: true },
          orderBy: { createdAt: "desc" },
        })
      : [];
    const monthlyVoteCounts = monthlyVoteBallots.reduce((acc, ballot) => {
      const key = ballot.candidateId;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    let monthlyVoteWinner = null;
    if (monthlyVoteCandidates.length) {
      monthlyVoteWinner = [...monthlyVoteCandidates]
        .map((candidate) => ({
          ...candidate,
          votes: monthlyVoteCounts[candidate.id] || 0,
        }))
        .sort((a, b) => {
          if (b.votes !== a.votes) return b.votes - a.votes;
          if (b.score !== a.score) return (b.score || 0) - (a.score || 0);
          return String(a.name || "").localeCompare(String(b.name || ""));
        })[0];
    }

    const now = new Date();
    const monthlyVoteClosed =
      !!monthlyVoteSession?.expiresAt &&
      new Date(monthlyVoteSession.expiresAt).getTime() <= now.getTime();

    const closedSessions = await prisma.monthlyVoteSession.findMany({
      where: { expiresAt: { lt: now } },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    });

    const winnersHistory = [];
    for (const session of closedSessions) {
      const ballots = await prisma.monthlyVoteBallot.findMany({
        where: { token: { sessionId: session.id } },
        include: { candidate: true },
      });
      if (!ballots.length) continue;
      const counts = ballots.reduce((acc, ballot) => {
        acc[ballot.candidateId] = (acc[ballot.candidateId] || 0) + 1;
        return acc;
      }, {});
      const winner = ballots
        .map((b) => b.candidate)
        .filter(Boolean)
        .map((candidate) => ({
          candidate,
          votes: counts[candidate.id] || 0,
        }))
        .sort((a, b) => b.votes - a.votes)[0];
      if (!winner) continue;
      winnersHistory.push({
        month: session.month,
        year: session.year,
        name: winner.candidate.name,
        votes: winner.votes,
      });
    }

    res.render("admin_monthly_vote", {
      title: "Votacao do mes",
      mvMonth,
      mvYear,
      monthNames,
      monthlyVoteSession,
      monthlyVoteTokens,
      monthlyVoteCandidates,
      monthlyVoteBallots,
      monthlyVoteCounts,
      monthlyVoteWinner,
      monthlyVoteClosed,
      winnersHistory,
      voteBaseUrl,
      monthlyVoteError: req.query.monthlyVoteError || null,
      monthlyVoteCreated: req.query.monthlyVoteCreated === "1",
    });
  } catch (err) {
    console.error("Erro ao carregar votacao do mes:", err);
    res.status(500).send("Erro ao carregar votacao do mes.");
  }
});

// ==============================
// ?? Encerrar votacao do mes
// ==============================
router.post("/monthly-vote/:id/close", requireAdmin, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.redirect("/admin/monthly-vote");

    await prisma.monthlyVoteSession.update({
      where: { id: sessionId },
      data: { expiresAt: new Date() },
    });

    return res.redirect("/admin/monthly-vote?monthlyVoteClosed=1");
  } catch (err) {
    console.error("Erro ao encerrar votacao do mes:", err);
    return res.redirect("/admin/monthly-vote?monthlyVoteError=close");
  }
});

// ==============================
// ??? Excluir votacao do mes
// ==============================
router.post("/monthly-vote/:id/delete", requireAdmin, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!sessionId) return res.redirect("/admin/monthly-vote");

    await prisma.$transaction(async (tx) => {
      await tx.monthlyVoteBallot.deleteMany({
        where: { token: { sessionId } },
      });
      await tx.monthlyVoteToken.deleteMany({ where: { sessionId } });
      await tx.monthlyVoteSession.delete({ where: { id: sessionId } });
    });

    return res.redirect("/admin/monthly-vote");
  } catch (err) {
    console.error("Erro ao excluir votacao do mes:", err);
    return res.redirect("/admin/monthly-vote");
  }
});

// ==============================
// ?? Jogadores - CRUD
// ==============================

// Adicionar jogador (com upload de foto)
router.post(
  "/players",
  requireAdmin,
  uploadPlayerPhoto.single("photo"),
  async (req, res) => {
    try {
      const { name, nickname, position, whatsapp, hallStatus, hallReasonText, baseOverall, overrideOverall } = req.body;

      if (!name || !position) {
        return res.redirect("/admin");
      }
      
      let formattedWhatsapp = null;
      if (whatsapp) {
        const digitsOnly = whatsapp.replace(/\D/g, '');
        if (digitsOnly) {
          formattedWhatsapp = `55${digitsOnly}`;
        }
      }

      let photoUrl = null;
      if (req.file) {
        photoUrl = `/uploads/players/${req.file.filename}`;
      }

      const baseOv = Math.round(Number(baseOverall));
      const manualOvRaw = Number(overrideOverall);
      const manualOv = Number.isFinite(manualOvRaw) ? Math.round(manualOvRaw) : null;

      await prisma.player.create({
        data: {
          name,
          nickname: nickname || null,
          position,
          whatsapp: formattedWhatsapp,
          photoUrl,
          baseOverall: Number.isFinite(baseOv) ? baseOv : 60,
          overallDynamic: manualOv,
          totalGoals: 0,
          totalAssists: 0,
          totalMatches: 0,
          totalPhotos: 0,
          totalRating: 0,
        },
      });

      res.redirect("/admin");
    } catch (err) {
      console.error("Erro ao adicionar jogador:", err);
      res.redirect("/admin");
    }
  }
);

// Página para editar jogador
router.get("/players/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin#jogadores");
    }

    const player = await prisma.player.findUnique({
      where: { id },
    });

    if (!player) {
      return res.redirect("/admin#jogadores");
    }

    res.render("admin_player_edit", {
      title: `Editar ${player.name}`,
      player,
    });
  } catch (err) {
    console.error("Erro ao carregar página de edi––o de jogador:", err);
    res.redirect("/admin#jogadores");
  }
});

// Editar jogador
router.post(
  "/players/:id/edit",
  requireAdmin,
  uploadPlayerPhoto.single("photo"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { name, nickname, position, whatsapp, hallStatus, hallReasonText, baseOverall, overrideOverall } = req.body;

      if (!name || !position || Number.isNaN(id)) {
        return res.redirect("/admin");
      }
      
      let formattedWhatsapp = null;
      if (whatsapp) {
        const digitsOnly = whatsapp.replace(/\D/g, '');
        if (digitsOnly) {
          formattedWhatsapp = `55${digitsOnly}`;
        }
      }

      let photoUrl = null;
      if (req.file) {
        photoUrl = `/uploads/players/${req.file.filename}`;
      }

      const data = {
        name,
        nickname: nickname || null,
        position,
        whatsapp: formattedWhatsapp,
      };

      const baseOv = Math.round(Number(baseOverall));
      if (Number.isFinite(baseOv)) {
        data.baseOverall = baseOv;
      }

      const manualOvRaw = Number(overrideOverall);
      if (Number.isFinite(manualOvRaw)) {
        data.overallDynamic = Math.round(manualOvRaw);
      } else {
        // Se vazio, remove override manual
        data.overallDynamic = null;
      }

      // Hall / aposentadoria
      const status = hallStatus || "active";
      if (status === "retired") {
        data.isHallOfFame = false;
        data.hallReason = "Aposentado";
      } else {
        data.isHallOfFame = false;
        data.hallReason = hallReasonText || null;
      }

      // Se enviou nova foto, atualiza photoUrl; caso contr–rio, mant–m a atual
      if (photoUrl) {
        data.photoUrl = photoUrl;
      }

      await prisma.player.update({
        where: { id },
        data,
      });

      res.redirect("/admin#jogadores");
    } catch (err) {
      console.error("Erro ao editar jogador:", err);
      res.redirect("/admin");
    }
  }
);

// Excluir jogador
router.post("/players/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    await prisma.playerStat.deleteMany({
      where: { playerId: id },
    });

    await prisma.player.delete({
      where: { id },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir jogador:", err);
    res.redirect("/admin");
  }
});

// ==============================
// ?? Peladas (Matches) - CRUD

function parsePlayedAt({ playedAt, playedDate, playedTime }) {
  if (playedAt) {
    const parsed = new Date(playedAt);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (playedDate) {
    const time = playedTime && playedTime.trim() ? playedTime.trim() : "00:00";
    const parsed = new Date(`${playedDate}T${time}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function buildRoundRobinSchedule(teamIds) {
  if (!Array.isArray(teamIds) || teamIds.length !== 4) return [];
  const [t1, t2, t3, t4] = teamIds;
  return [
    { stage: "GROUP", round: 1, homeTeamId: t1, awayTeamId: t4 },
    { stage: "GROUP", round: 1, homeTeamId: t2, awayTeamId: t3 },
    { stage: "GROUP", round: 2, homeTeamId: t4, awayTeamId: t3 },
    { stage: "GROUP", round: 2, homeTeamId: t1, awayTeamId: t2 },
    { stage: "GROUP", round: 3, homeTeamId: t2, awayTeamId: t4 },
    { stage: "GROUP", round: 3, homeTeamId: t3, awayTeamId: t1 },
  ];
}

function shuffleSchedule(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleTeams(teamIds) {
  const arr = [...teamIds];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function computeTournamentStandings(tournamentId) {
  const id = Number(tournamentId);
  if (Number.isNaN(id)) return [];

  const [teams, games] = await Promise.all([
    prisma.tournamentTeam.findMany({
      where: { tournamentId: id },
      orderBy: { id: "asc" },
    }),
    prisma.tournamentGame.findMany({
      where: { tournamentId: id, stage: "GROUP" },
    }),
  ]);

  const table = new Map();
  teams.forEach((team) => {
    table.set(team.id, {
      teamId: team.id,
      name: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      pts: 0,
    });
  });

  games.forEach((game) => {
    if (game.homeGoals == null || game.awayGoals == null) return;
    const home = table.get(game.homeTeamId);
    const away = table.get(game.awayTeamId);
    if (!home || !away) return;

    home.played += 1;
    away.played += 1;
    home.gf += game.homeGoals;
    home.ga += game.awayGoals;
    away.gf += game.awayGoals;
    away.ga += game.homeGoals;

    if (game.homeGoals > game.awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.pts += 3;
    } else if (game.homeGoals < game.awayGoals) {
      away.wins += 1;
      home.losses += 1;
      away.pts += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.pts += 1;
      away.pts += 1;
    }
  });

  table.forEach((row) => {
    row.gd = row.gf - row.ga;
  });

  const standings = Array.from(table.values()).sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.teamId - b.teamId;
  });

  standings.forEach((row, idx) => {
    row.position = idx + 1;
  });

  return standings;
}

// Criar nova pelada
router.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { playedAt, playedDate, playedTime, description, winnerTeam, winnerColor } = req.body;

    const playedDateValue = parsePlayedAt({ playedAt, playedDate, playedTime });
    if (!playedDateValue) {
      return res.redirect("/admin");
    }

    await prisma.match.create({
      data: {
        playedAt: playedDateValue,
        description: description || null,
        winnerTeam: winnerTeam || null,
        winnerColor: winnerColor || null,
      },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao criar pelada:", err);
    res.redirect("/admin");
  }
});
// Editar pelada
router.post("/matches/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { playedAt, playedDate, playedTime, description, winnerTeam, winnerColor } = req.body;

    const playedDateValue = parsePlayedAt({ playedAt, playedDate, playedTime });
    if (Number.isNaN(id) || !playedDateValue) {
      return res.redirect("/admin");
    }

    await prisma.match.update({
      where: { id },
      data: {
        playedAt: playedDateValue,
        description: description || null,
        winnerTeam: winnerTeam || null,
        winnerColor: winnerColor || null,
      },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao editar pelada:", err);
    res.redirect("/admin");
  }
});

// Criar torneio vinculado a uma pelada (4 times)
router.post("/matches/:id/tournament/create", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }
    if (!prisma.tournament || !prisma.tournamentTeam || !prisma.tournamentGame) {
      return res.redirect(`/admin/matches/${matchId}?error=tournamentModelMissing`);
    }

    const rawTeams = Array.isArray(req.body.teams) ? req.body.teams : null;
    const teamsFromFields = rawTeams
      ? rawTeams
      : [1, 2, 3, 4].map((idx) => ({
          name: req.body[`team${idx}Name`],
          color: req.body[`team${idx}Color`],
        }));

    const teams = teamsFromFields
      .map((team) => ({
        name: team?.name ? String(team.name).trim() : "",
        color: team?.color ? String(team.color).trim() : null,
      }))
      .filter((team) => team.name);

    if (teams.length !== 4) {
      return res.redirect(`/admin/matches/${matchId}?error=tournamentTeams`);
    }

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) {
      return res.redirect("/admin");
    }

    const existing = await prisma.tournament.findUnique({
      where: { matchId },
      select: { id: true },
    });
    if (existing) {
      return res.redirect(`/admin/matches/${matchId}?error=tournamentExists`);
    }

    await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.create({
        data: {
          match: { connect: { id: matchId } },
          teams: {
            create: teams.map((team) => ({
              name: team.name,
              color: team.color || null,
            })),
          },
        },
        include: { teams: true },
      });

      const teamIds = tournament.teams.map((team) => team.id);
      const shuffledTeams = shuffleTeams(teamIds);
      const schedule = shuffleSchedule(buildRoundRobinSchedule(shuffledTeams));
      if (schedule.length) {
        await tx.tournamentGame.createMany({
          data: schedule.map((game) => ({
            tournamentId: tournament.id,
            stage: game.stage,
            round: game.round,
            homeTeamId: game.homeTeamId,
            awayTeamId: game.awayTeamId,
          })),
        });
      }
    });

    return res.redirect(`/admin/matches/${matchId}?tournamentCreated=true`);
  } catch (err) {
    console.error("Erro ao criar torneio:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=tournamentCreate`);
  }
});

// Importar times do sorteador para o torneio
router.post("/matches/:id/tournament/import-from-draw", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }
    if (!prisma.tournament || !prisma.tournamentTeam || !prisma.tournamentGame) {
      return res.redirect(`/admin/matches/${matchId}?error=tournamentModelMissing`);
    }

    const normalizeTeamLabel = (value) => {
      const raw = value ? String(value).trim().toLowerCase() : "";
      if (raw.includes("preto")) return "Preto";
      if (raw.includes("vermelho")) return "Vermelho";
      if (raw.includes("azul")) return "Azul";
      if (raw.includes("amarelo")) return "Amarelo";
      return "Preto";
    };
    const sponsorNameByLabel = {
      Amarelo: "Natureza em Flores",
      Vermelho: "Matheus Gomes Barbearia",
      Azul: "Carrocerias Santana",
      Preto: "Advance Compressores",
    };
    const normalizeArray = (value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        return Object.keys(value)
          .sort((a, b) => Number(a) - Number(b))
          .map((key) => value[key]);
      }
      return value != null ? [value] : [];
    };

    const bodyNamesRaw = normalizeArray(req.body.teamNames);
    const bodyColorsRaw = normalizeArray(req.body.teamColors);

    let drawTeams = null;
    if (bodyNamesRaw.length === 4 && bodyColorsRaw.length === 4) {
      drawTeams = bodyColorsRaw.map((color, idx) => {
        const colorRaw = color ? String(color).trim() : "";
        const label = normalizeTeamLabel(colorRaw || bodyNamesRaw[idx]);
        return {
          name: sponsorNameByLabel[label] || `Time ${label}`,
          color: colorRaw || null,
        };
      });
    } else {
      const lastLineupDraw = await prisma.lineupDraw.findFirst({
        where: { matchId },
        orderBy: { createdAt: "desc" },
      });

      const drawTeamsRaw = lastLineupDraw?.result?.teams || [];
      if (!Array.isArray(drawTeamsRaw) || drawTeamsRaw.length !== 4) {
        return res.redirect(`/admin/matches/${matchId}?error=drawTeamsInvalid`);
      }

      drawTeams = drawTeamsRaw.map((team) => {
        const colorName = team?.colorName ? String(team.colorName).trim() : "";
        const colorValue = team?.colorValue ? String(team.colorValue).trim() : "";
        const label = normalizeTeamLabel(colorName || colorValue);
        return {
          name: sponsorNameByLabel[label] || `Time ${label}`,
          color: colorValue || colorName || null,
        };
      });
    }

    await prisma.$transaction(async (tx) => {
      const tournament = await tx.tournament.findUnique({
        where: { matchId },
        include: { teams: true },
      });

      if (!tournament) {
        const created = await tx.tournament.create({
          data: {
            match: { connect: { id: matchId } },
            teams: { create: drawTeams },
          },
          include: { teams: true },
        });

        const teamIds = created.teams.map((t) => t.id);
        const shuffledTeams = shuffleTeams(teamIds);
        const schedule = shuffleSchedule(buildRoundRobinSchedule(shuffledTeams));
        if (schedule.length) {
          await tx.tournamentGame.createMany({
            data: schedule.map((game) => ({
              tournamentId: created.id,
              stage: game.stage,
              round: game.round,
              homeTeamId: game.homeTeamId,
              awayTeamId: game.awayTeamId,
            })),
          });
        }
        return;
      }

      const existingTeams = [...(tournament.teams || [])].sort((a, b) => a.id - b.id);
      if (existingTeams.length !== 4) {
        throw new Error("tournamentTeamsInvalid");
      }

      await Promise.all(
        existingTeams.map((team, idx) =>
          tx.tournamentTeam.update({
            where: { id: team.id },
            data: {
              name: drawTeams[idx]?.name || team.name,
              color: drawTeams[idx]?.color || null,
            },
          })
        )
      );
    });

    return res.redirect(`/admin/matches/${matchId}?tournamentImported=true`);
  } catch (err) {
    if (err && err.message === "tournamentTeamsInvalid") {
      return res.redirect(`/admin/matches/${req.params.id}?error=tournamentTeamsInvalid`);
    }
    console.error("Erro ao importar times do sorteador:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=importFromDraw`);
  }
});

// Salvar resultado de jogo do torneio (fase de grupos)
router.post("/tournament/game/:gameId/result", requireAdmin, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (Number.isNaN(gameId)) {
      return res.redirect("/admin");
    }

    const homeGoalsRaw = req.body.homeGoals;
    const awayGoalsRaw = req.body.awayGoals;
    const homeGoals = Number.isFinite(Number(homeGoalsRaw)) ? Number(homeGoalsRaw) : null;
    const awayGoals = Number.isFinite(Number(awayGoalsRaw)) ? Number(awayGoalsRaw) : null;

    if (homeGoals == null || awayGoals == null) {
      return res.redirect("/admin");
    }

    const game = await prisma.tournamentGame.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        tournamentId: true,
        stage: true,
        tournament: { select: { matchId: true } },
      },
    });

    if (!game) {
      return res.redirect("/admin");
    }

    let winnerTeamId = null;
    let decidedBy = null;

    if (homeGoals > awayGoals) {
      winnerTeamId = game.homeTeamId;
    } else if (awayGoals > homeGoals) {
      winnerTeamId = game.awayTeamId;
    } else if (game.stage === "SEMI") {
      const standings = await computeTournamentStandings(game.tournamentId);
      const positionByTeamId = new Map(
        standings.map((row, idx) => [row.teamId, idx + 1])
      );
      const homePos = positionByTeamId.get(game.homeTeamId) ?? 99;
      const awayPos = positionByTeamId.get(game.awayTeamId) ?? 99;
      winnerTeamId = homePos <= awayPos ? game.homeTeamId : game.awayTeamId;
      decidedBy = "ADVANTAGE";
    }

    await prisma.tournamentGame.update({
      where: { id: gameId },
      data: {
        homeGoals,
        awayGoals,
        winnerTeamId,
        decidedBy,
        homePenalties: null,
        awayPenalties: null,
      },
    });

    const matchId = game.tournament?.matchId;
    const referer = req.get("referer");
    return res.redirect(referer || (matchId ? `/admin/matches/${matchId}` : "/admin"));
  } catch (err) {
    console.error("Erro ao salvar resultado do jogo do torneio:", err);
    return res.redirect("/admin");
  }
});

// Gerar semifinais
router.post("/matches/:id/tournament/generate-semis", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const tournament = await prisma.tournament.findUnique({
      where: { matchId },
      include: {
        teams: { select: { id: true } },
        games: { select: { id: true, stage: true, homeGoals: true, awayGoals: true } },
      },
    });

    if (!tournament) {
      return res.redirect(`/admin/matches/${matchId}?error=noTournament`);
    }

    const groupGames = tournament.games.filter((g) => g.stage === "GROUP");
    const existingSemis = tournament.games.filter((g) => g.stage === "SEMI");
    const allGroupScored = groupGames.length > 0 && groupGames.every(
      (g) => g.homeGoals != null && g.awayGoals != null
    );

    if (!allGroupScored) {
      return res.redirect(`/admin/matches/${matchId}?error=groupNotComplete`);
    }

    if (existingSemis.length > 0) {
      return res.redirect(`/admin/matches/${matchId}?error=semisExists`);
    }

    const standings = await computeTournamentStandings(tournament.id);
    if (standings.length < 4) {
      return res.redirect(`/admin/matches/${matchId}?error=standingsIncomplete`);
    }

    await prisma.tournamentGame.createMany({
      data: [
        {
          tournamentId: tournament.id,
          stage: "SEMI",
          round: 1,
          homeTeamId: standings[0].teamId,
          awayTeamId: standings[3].teamId,
        },
        {
          tournamentId: tournament.id,
          stage: "SEMI",
          round: 2,
          homeTeamId: standings[1].teamId,
          awayTeamId: standings[2].teamId,
        },
      ],
    });

    return res.redirect(`/admin/matches/${matchId}?semisCreated=true`);
  } catch (err) {
    console.error("Erro ao gerar semifinais:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=generateSemis`);
  }
});

// Gerar final
router.post("/matches/:id/tournament/generate-final", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const tournament = await prisma.tournament.findUnique({
      where: { matchId },
      include: {
        games: {
          select: {
            id: true,
            stage: true,
            winnerTeamId: true,
            homeTeamId: true,
            awayTeamId: true,
          },
        },
      },
    });

    if (!tournament) {
      return res.redirect(`/admin/matches/${matchId}?error=noTournament`);
    }

    const semis = tournament.games.filter((g) => g.stage === "SEMI");
    const finalExists = tournament.games.some((g) => g.stage === "FINAL");

    if (finalExists) {
      return res.redirect(`/admin/matches/${matchId}?error=finalExists`);
    }

    if (semis.length !== 2 || semis.some((g) => !g.winnerTeamId)) {
      return res.redirect(`/admin/matches/${matchId}?error=semisIncomplete`);
    }

    const semiOneLoser =
      semis[0].winnerTeamId === semis[0].homeTeamId ? semis[0].awayTeamId : semis[0].homeTeamId;
    const semiTwoLoser =
      semis[1].winnerTeamId === semis[1].homeTeamId ? semis[1].awayTeamId : semis[1].homeTeamId;

    await prisma.tournamentGame.createMany({
      data: [
        {
          tournamentId: tournament.id,
          stage: "FINAL",
          round: 1,
          homeTeamId: semis[0].winnerTeamId,
          awayTeamId: semis[1].winnerTeamId,
        },
        {
          tournamentId: tournament.id,
          stage: "FINAL",
          round: 2,
          homeTeamId: semiOneLoser,
          awayTeamId: semiTwoLoser,
        },
      ],
    });

    return res.redirect(`/admin/matches/${matchId}?finalCreated=true`);
  } catch (err) {
    console.error("Erro ao gerar final:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=generateFinal`);
  }
});

// Salvar penaltis da final
router.post("/tournament/game/:gameId/pens", requireAdmin, async (req, res) => {
  try {
    const gameId = Number(req.params.gameId);
    if (Number.isNaN(gameId)) {
      return res.redirect("/admin");
    }

    const homePensRaw = req.body.homePens;
    const awayPensRaw = req.body.awayPens;
    const homePens = Number.isFinite(Number(homePensRaw)) ? Number(homePensRaw) : null;
    const awayPens = Number.isFinite(Number(awayPensRaw)) ? Number(awayPensRaw) : null;

    if (homePens == null || awayPens == null) {
      return res.redirect("/admin");
    }

    const game = await prisma.tournamentGame.findUnique({
      where: { id: gameId },
      select: {
        id: true,
        stage: true,
        homeGoals: true,
        awayGoals: true,
        homeTeamId: true,
        awayTeamId: true,
        tournament: { select: { matchId: true } },
      },
    });

    if (!game || game.stage !== "FINAL") {
      return res.redirect("/admin");
    }

    if (game.homeGoals == null || game.awayGoals == null || game.homeGoals !== game.awayGoals) {
      return res.redirect("/admin");
    }

    let winnerTeamId = null;
    if (homePens > awayPens) {
      winnerTeamId = game.homeTeamId;
    } else if (awayPens > homePens) {
      winnerTeamId = game.awayTeamId;
    }

    await prisma.tournamentGame.update({
      where: { id: gameId },
      data: {
        homePenalties: homePens,
        awayPenalties: awayPens,
        winnerTeamId,
        decidedBy: "PENALTIES",
      },
    });

    const matchId = game.tournament?.matchId;
    const referer = req.get("referer");
    return res.redirect(referer || (matchId ? `/admin/matches/${matchId}` : "/admin"));
  } catch (err) {
    console.error("Erro ao salvar penaltis da final:", err);
    return res.redirect("/admin");
  }
});

// Resetar torneio de uma pelada
router.post("/matches/:id/tournament/reset", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const tournament = await prisma.tournament.findUnique({
      where: { matchId },
      select: { id: true },
    });

    if (!tournament) {
      return res.redirect(`/admin/matches/${matchId}?error=noTournament`);
    }

    await prisma.$transaction([
      prisma.tournamentGame.deleteMany({ where: { tournamentId: tournament.id } }),
      prisma.tournamentTeam.deleteMany({ where: { tournamentId: tournament.id } }),
      prisma.tournament.delete({ where: { id: tournament.id } }),
    ]);

    return res.redirect(`/admin/matches/${matchId}?tournamentReset=true`);
  } catch (err) {
    console.error("Erro ao resetar torneio:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=tournamentReset`);
  }
});
// Excluir pelada (apaga stats primeiro)
router.post("/matches/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin");
    }

    // Identifica entidades relacionadas para evitar erros de FK
    const voteSessions = await prisma.voteSession.findMany({
      where: { matchId: id },
      select: { id: true },
    });
    const sessionIds = voteSessions.map((s) => s.id);

    const voteTokens = sessionIds.length
      ? await prisma.voteToken.findMany({
          where: { voteSessionId: { in: sessionIds } },
          select: { id: true },
        })
      : [];
    const tokenIds = voteTokens.map((t) => t.id);

    const ballots = tokenIds.length
      ? await prisma.voteBallot.findMany({
          where: { voteTokenId: { in: tokenIds } },
          select: { id: true },
        })
      : [];
    const ballotIds = ballots.map((b) => b.id);

    const voteLinks = prisma.voteLink
      ? await prisma.voteLink.findMany({
          where: { matchId: id },
          select: { id: true },
        })
      : [];
    const voteLinkIds = voteLinks.map((v) => v.id);

    const publicVotes = prisma.publicVote
      ? await prisma.publicVote.findMany({
          where: { matchId: id },
          select: { id: true },
        })
      : [];
    const publicVoteIds = publicVotes.map((v) => v.id);

    await prisma.$transaction([
      ballotIds.length
        ? prisma.voteRanking.deleteMany({
            where: { voteBallotId: { in: ballotIds } },
          })
        : prisma.$executeRaw`SELECT 1`,
      ballotIds.length
        ? prisma.voteRating.deleteMany({
            where: { voteBallotId: { in: ballotIds } },
          })
        : prisma.$executeRaw`SELECT 1`,
      ballotIds.length
        ? prisma.voteBallot.deleteMany({ where: { id: { in: ballotIds } } })
        : prisma.$executeRaw`SELECT 1`,
      tokenIds.length
        ? prisma.voteToken.deleteMany({ where: { id: { in: tokenIds } } })
        : prisma.$executeRaw`SELECT 1`,
      sessionIds.length
        ? prisma.voteSession.deleteMany({ where: { id: { in: sessionIds } } })
        : prisma.$executeRaw`SELECT 1`,

      voteLinkIds.length
        ? prisma.voteChoice.deleteMany({
            where: { voteLinkId: { in: voteLinkIds } },
          })
        : prisma.$executeRaw`SELECT 1`,
      voteLinkIds.length
        ? prisma.voteLink.deleteMany({ where: { id: { in: voteLinkIds } } })
        : prisma.$executeRaw`SELECT 1`,

      publicVoteIds.length
        ? prisma.publicVoteRanking.deleteMany({
            where: { publicVoteId: { in: publicVoteIds } },
          })
        : prisma.$executeRaw`SELECT 1`,
      publicVoteIds.length
        ? prisma.publicVote.deleteMany({ where: { id: { in: publicVoteIds } } })
        : prisma.$executeRaw`SELECT 1`,

      prisma.lineupDraw.deleteMany({ where: { matchId: id } }),

      prisma.weeklyAward.updateMany({
        where: { winningMatchId: id },
        data: { winningMatchId: null },
      }),

      prisma.playerStat.deleteMany({
        where: { matchId: id },
      }),

      prisma.match.delete({
        where: { id },
      }),
    ]);

    return res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir pelada:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// Votos da pelada (sessao mais recente)
router.get("/matches/:id/votes", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) return res.redirect("/admin");

    const session = await prisma.voteSession.findFirst({
      where: { matchId: id },
      orderBy: { createdAt: "desc" },
    });

    const ballots = await prisma.voteBallot.findMany({
      where: { token: { session: { matchId: id } } },
      include: {
        token: { include: { player: true } },
        ratings: { include: { player: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.render("admin_votes", {
      title: "Votos da pelada",
      match,
      session,
      ballots,
    });
  } catch (err) {
    console.error("Erro ao listar votos da pelada:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// Selecionar pelada para lancar stats
// ==============================
router.get("/matches", requireAdmin, (req, res) => {
  const { matchId } = req.query;

  if (!matchId) {
    return res.redirect("/admin");
  }

  const id = Number(matchId);
  if (Number.isNaN(id)) {
    return res.redirect("/admin");
  }

  return res.redirect(`/admin/matches/${id}`);
});

// ==============================
// ?? Salvar estatísticas em massa da pelada
// ==============================
router.post("/matches/:id/stats/bulk", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const [players, existingStats] = await Promise.all([
      prisma.player.findMany(),
      prisma.playerStat.findMany({
        where: { matchId },
      }),
    ]);

    const statsByPlayerId = new Map();
    for (const stat of existingStats) {
      statsByPlayerId.set(stat.playerId, stat);
    }

    const touchedPlayerIds = new Set();

    for (const player of players) {
      const playerId = player.id;
      touchedPlayerIds.add(playerId);

      const present = !!req.body[`present_${playerId}`];

      const goalsRaw = req.body[`goals_${playerId}`];
      const assistsRaw = req.body[`assists_${playerId}`];
      const ratingRaw = req.body[`rating_${playerId}`];
      const photo = !!req.body[`photo_${playerId}`];

      const goals = goalsRaw ? parseInt(goalsRaw, 10) || 0 : 0;
      const assists = assistsRaw ? parseInt(assistsRaw, 10) || 0 : 0;

      let rating = null;
      if (ratingRaw && ratingRaw.trim() !== "") {
        const normalized = ratingRaw.replace(",", ".");
        const parsed = parseFloat(normalized);
        if (!Number.isNaN(parsed)) {
          rating = parsed;
        }
      }

      const appearedInPhoto = photo;

      const hasAnyData =
        present || goals > 0 || assists > 0 || rating !== null || appearedInPhoto;

      const existing = statsByPlayerId.get(playerId);

      if (!hasAnyData) {
        if (existing) {
          await prisma.playerStat.delete({
            where: { id: existing.id },
          });
        }
        continue;
      }

      if (existing) {
        await prisma.playerStat.update({
          where: { id: existing.id },
          data: {
            present,
            goals,
            assists,
            rating,
            appearedInPhoto,
          },
        });
      } else {
        await prisma.playerStat.create({
          data: {
            playerId,
            matchId,
            present,
            goals,
            assists,
            rating,
            appearedInPhoto,
          },
        });
      }
    }

    await recomputeTotalsForPlayers(Array.from(touchedPlayerIds));

    if (Object.prototype.hasOwnProperty.call(req.body, "winnerColor")) {
      const winnerColor = (req.body.winnerColor || "").trim();
      await prisma.match.update({
        where: { id: matchId },
        data: { winnerColor: winnerColor || null },
      });
    }

    res.redirect(`/admin/matches/${matchId}`);
  } catch (err) {
    console.error("Erro ao salvar estatísticas da pelada:", err);
    res.redirect(`/admin/matches/${req.params.id}`);
  }
});

// ==============================
// ?? Destaques (semana / mês)
// ==============================

// Craque + Time da semana
router.post(
  "/weekly-awards",
  requireAdmin,
  uploadWeeklyTeamPhoto.single("teamPhoto"),
  async (req, res) => {
    try {
      const { weekStart, bestPlayerId, winningMatchId } = req.body;

      if (!weekStart) {
        return res.redirect("/admin");
      }

      const weekDate = new Date(weekStart);

      const rawBest = bestPlayerId;
      const rawMatch = winningMatchId;

      const bestId = rawBest && rawBest !== "" ? Number(rawBest) : null;
      const matchId = rawMatch && rawMatch !== "" ? Number(rawMatch) : null;

      const existing = await prisma.weeklyAward.findFirst({
        where: { weekStart: weekDate },
      });

      if (existing) {
        const updateData = {
          weekStart: weekDate,
        };

        if (req.file) {
          updateData.teamPhotoUrl = `/uploads/weekly/${req.file.filename}`;
        }

        if (typeof rawBest !== "undefined") {
          if (bestId) {
            updateData.bestPlayer = { connect: { id: bestId } };
          } else {
            updateData.bestPlayer = { disconnect: true };
          }
        }

        if (typeof rawMatch !== "undefined") {
          if (matchId) {
            updateData.winningMatch = { connect: { id: matchId } };
          } else {
            updateData.winningMatch = { disconnect: true };
          }
        }

        await prisma.weeklyAward.update({
          where: { id: existing.id },
          data: updateData,
        });
      } else {
        const createData = {
          weekStart: weekDate,
          teamPhotoUrl: req.file ? `/uploads/weekly/${req.file.filename}` : null,
        };

        if (bestId) {
          createData.bestPlayer = { connect: { id: bestId } };
        }

        if (matchId) {
          createData.winningMatch = { connect: { id: matchId } };
        }

        await prisma.weeklyAward.create({
          data: createData,
        });
      }

      res.redirect("/admin");
    } catch (err) {
      console.error("Erro ao salvar destaque da semana:", err);
      res.redirect("/admin");
    }
  }
);

// Excluir destaque da semana
router.post("/weekly-awards/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    await prisma.weeklyAward.delete({
      where: { id },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir destaque da semana:", err);
    res.redirect("/admin");
  }
});

// Craque do mês
router.post("/monthly-awards", requireAdmin, async (req, res) => {
  try {
    const { month, year, craqueId } = req.body;

    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const playerId = craqueId && craqueId !== "" ? Number(craqueId) : null;

    if (!m || !y) {
      return res.redirect("/admin");
    }

    const existing = await prisma.monthlyAward.findFirst({
      where: { month: m, year: y },
    });

    if (existing) {
      const updateData = {
        month: m,
        year: y,
      };

      if (typeof craqueId !== "undefined") {
        if (playerId) {
          updateData.craque = { connect: { id: playerId } };
        } else {
          updateData.craque = { disconnect: true };
        }
      }

      await prisma.monthlyAward.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      const createData = {
        month: m,
        year: y,
      };

      if (playerId) {
        createData.craque = { connect: { id: playerId } };
      }

      await prisma.monthlyAward.create({
        data: createData,
      });
    }

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao salvar craque do mês:", err);
    res.redirect("/admin");
  }
});

// ==============================
// ??? Votação do mês (Top 5)
// ==============================
router.post("/monthly-vote-session", requireAdmin, async (req, res) => {
  try {
    const month = Number(req.body.month);
    const year = Number(req.body.year);

    if (!Number.isFinite(month) || month < 1 || month > 12 || !Number.isFinite(year)) {
      return res.redirect("/admin/monthly-vote?monthlyVoteError=invalidDate");
    }

    const { candidates, eligibleVoters } = await computeMonthlyVoteData(month, year);

    if (!eligibleVoters.length) {
      return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteError=noVoters`);
    }
    if (!candidates.length) {
      return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteError=noCandidates`);
    }

    const uniqueVoters = Array.from(new Set(eligibleVoters));

    await prisma.$transaction(async (tx) => {
      const existing = await tx.monthlyVoteSession.findUnique({
        where: { month_year: { month, year } },
      });

      if (existing) {
        const tokens = await tx.monthlyVoteToken.findMany({
          where: { sessionId: existing.id },
          select: { id: true },
        });
        const tokenIds = tokens.map((t) => t.id);
        if (tokenIds.length) {
          await tx.monthlyVoteBallot.deleteMany({
            where: { tokenId: { in: tokenIds } },
          });
          await tx.monthlyVoteToken.deleteMany({
            where: { id: { in: tokenIds } },
          });
        }
      }

      const session = existing
        ? await tx.monthlyVoteSession.update({
            where: { month_year: { month, year } },
            data: {
              candidates,
              createdByAdminId: req.admin?.id ?? null,
              createdAt: new Date(),
              expiresAt: null,
            },
          })
        : await tx.monthlyVoteSession.create({
            data: {
              month,
              year,
              candidates,
              createdByAdminId: req.admin?.id ?? null,
            },
          });

      const tokensData = uniqueVoters.map((playerId) => ({
        token: crypto.randomBytes(16).toString("hex"),
        sessionId: session.id,
        playerId,
      }));

      if (tokensData.length) {
        await tx.monthlyVoteToken.createMany({ data: tokensData });
      }
    });

    return res.redirect(`/admin/monthly-vote?mvMonth=${month}&mvYear=${year}&monthlyVoteCreated=1`);
  } catch (err) {
    console.error("Erro ao gerar votação do mês:", err);
    return res.redirect("/admin/monthly-vote?monthlyVoteError=server");
  }
});

// Excluir craque do mês
router.post("/monthly-awards/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    await prisma.monthlyAward.delete({
      where: { id },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir craque do mês:", err);
    res.redirect("/admin");
  }
});

// ==============================
// ?? Premiação da temporada (SeasonAward)
// ==============================

// Tela de gest–o da premiação
router.get("/premiacao", requireAdmin, async (req, res) => {
  try {
    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    const awards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    const awardsByYear = awards.reduce((acc, award) => {
      if (!acc[award.year]) acc[award.year] = [];
      acc[award.year].push(award);
      return acc;
    }, {});

    res.render("admin_awards", {
      title: "Premiação da temporada",
      players,
      awardsByYear,
    });
  } catch (err) {
    console.error("Erro ao carregar tela de premiação:", err);
    res.status(500).send("Erro ao carregar premiação da temporada.");
  }
});

// Criar/atualizar prêmio de temporada
router.post("/season-awards", requireAdmin, async (req, res) => {
  try {
    const { year, category, playerId } = req.body;

    const y = parseInt(year, 10);
    const cat = category ? String(category) : null;
    const pId = playerId && playerId !== "" ? Number(playerId) : null;

    if (!y || !cat) {
      return res.redirect("/admin/premiacao");
    }

    // ?? NAO usamos mais year_category (nao existe no schema).
    // Ent–o buscamos primeiro, depois fazemos update OU create.
    const existing = await prisma.seasonAward.findFirst({
      where: {
        year: y,
        category: cat,
      },
    });

    if (existing) {
      await prisma.seasonAward.update({
        where: { id: existing.id },
        data: {
          playerId: pId,
        },
      });
    } else {
      await prisma.seasonAward.create({
        data: {
          year: y,
          category: cat,
          playerId: pId,
        },
      });
    }

    res.redirect("/admin/premiacao");
  } catch (err) {
    console.error("Erro ao salvar prêmio de temporada:", err);
    res.redirect("/admin/premiacao");
  }
});

// Excluir prêmio de temporada
router.post(
  "/season-awards/:id/delete",
  requireAdmin,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) {
        return res.redirect("/admin/premiacao");
      }

      await prisma.seasonAward.delete({
        where: { id },
      });

      res.redirect("/admin/premiacao");
    } catch (err) {
      console.error("Erro ao excluir prêmio de temporada:", err);
      res.redirect("/admin/premiacao");
    }
  }
);

// ==============================
// ?? Ver estatísticas de uma pelada (ADMIN)
// ==============================
router.get("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: true },
          orderBy: {
            player: { name: "asc" },
          },
        },
        voteSessions: {
          orderBy: { createdAt: 'desc' },
          include: {
            tokens: {
              include: { player: true },
            },
          },
        }
      },
    });

    if (!match) {
      return res.redirect("/admin");
    }

    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    // Overall de cada jogador (mesma m–trica do ranking)
    const { computed: playersOverall } = computeOverallFromEntries(
      players.map((p) => ({
        player: p,
        goals: p.totalGoals || 0,
        assists: p.totalAssists || 0,
        matches: p.totalMatches || 0,
        rating: p.totalRating || 0,
      }))
    );
    const overallById = new Map(playersOverall.map((o) => [o.player.id, o.overall]));
    const playersWithOverall = players.map((p) => ({
      ...p,
      overall: overallById.get(p.id) ?? null,
    }));
    
    const voteSession = match.voteSessions.length > 0 ? match.voteSessions[0] : null;
    const voteBaseUrl = `${req.protocol}://${req.get('host')}`;

    const lastLineupDraw = await prisma.lineupDraw.findFirst({
      where: { matchId: id },
      orderBy: { createdAt: "desc" },
    });

    const tournament = prisma.tournament
      ? await prisma.tournament.findUnique({
          where: { matchId: id },
          include: {
            teams: true,
            games: {
              include: {
                homeTeam: true,
                awayTeam: true,
                winnerTeam: true,
              },
            },
          },
        })
      : null;
    const tournamentStandings = tournament
      ? await computeTournamentStandings(tournament.id)
      : [];
    const stageOrder = { GROUP: 1, SEMI: 2, FINAL: 3 };
    const tournamentGames = tournament
      ? [...(tournament.games || [])].sort((a, b) => {
          const sa = stageOrder[a.stage] || 99;
          const sb = stageOrder[b.stage] || 99;
          if (sa !== sb) return sa - sb;
          const ra = a.round != null ? a.round : 999;
          const rb = b.round != null ? b.round : 999;
          if (ra !== rb) return ra - rb;
          return (a.id || 0) - (b.id || 0);
        })
      : [];
    const tournamentTeams = tournament ? tournament.teams || [] : [];

    let displayStats = match.stats || [];
    try {
      const result = await computeMatchRatingsAndAwards(id);
      if (!result.error && result.scores && typeof result.scores.forEach === 'function') {
        const finalMap = new Map();
        result.scores.forEach((score) => {
          finalMap.set(score.player.id, score.finalRating);
        });
        displayStats = displayStats.map((stat) => {
          const finalRating = finalMap.has(stat.playerId)
            ? finalMap.get(stat.playerId)
            : null;
          return {
            ...stat,
            finalRating,
            rating: finalRating != null ? finalRating : stat.rating,
          };
        });
      }
    } catch (calcErr) {
      console.warn("Falha ao calcular nota final no admin:", calcErr);
    }

    res.render("admin_match", {
      title: "Estatísticas da pelada",
      match,
      players: playersWithOverall,
      stats: displayStats,
      tournament: tournament ? { ...tournament, games: tournamentGames } : null,
      tournamentTeams,
      tournamentGames,
      standings: tournamentStandings,
      tournamentStandings,
      voteSession, // Passando a sessão de votação para a view
      voteBaseUrl,
      req,
      lineupResult: lastLineupDraw ? lastLineupDraw.result : null,
    });
  } catch (err) {
    console.error("Erro ao carregar estatísticas da pelada:", err);
    res.redirect("/admin");
  }
});

// ==============================
// Vota––es privadas por link (admin)
// ==============================
router.post("/matches/:id/vote-session", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const expiresHours = Number(req.body.expiresHours ?? 24);
    const expiresAt =
      Number.isFinite(expiresHours) && expiresHours > 0
        ? new Date(Date.now() + expiresHours * 60 * 60 * 1000)
        : null;

    const statsPresent = await prisma.playerStat.findMany({
      where: { matchId, present: true },
    });

    if (!statsPresent.length) {
      return res.redirect(`/admin/matches/${matchId}?error=noPresentPlayers`);
    }

    const tokensData = statsPresent.map((s) => ({
      token: crypto.randomBytes(16).toString("hex"),
      playerId: s.playerId,
    }));

    await prisma.voteSession.create({
      data: {
        matchId,
        expiresAt,
        createdByAdminId: req?.admin?.id ?? null,
        tokens: {
          create: tokensData,
        },
      },
    });

    return res.redirect(`/admin/matches/${matchId}?voteSessionCreated=true`);
  } catch (err) {
    console.error("Erro ao criar sessão de votos:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=voteSession`);
  }
});

router.post("/matches/:id/close-votes", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const session = await prisma.voteSession.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
    });

    if (!session) {
      return res.redirect(`/admin/matches/${matchId}?error=noSession`);
    }

    await prisma.voteSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date() },
    });

    return res.redirect(`/admin/matches/${matchId}?votesClosed=true`);
  } catch (err) {
    console.error("Erro ao encerrar votação:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=closeVotes`);
  }
});

// Placeholder: aplicar votos como notas (a ser implementado)
router.post("/matches/:id/apply-votes", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  if (Number.isNaN(matchId)) return res.redirect("/admin");

  try {
    const session = await prisma.voteSession.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
      include: {
        tokens: {
          include: { ballot: { include: { rankings: true } } },
        },
      },
    });

    if (!session) {
      return res.redirect(`/admin/matches/${matchId}?error=noSession`);
    }

    const ballots = await prisma.voteBallot.findMany({
      where: { token: { voteSessionId: session.id } },
      include: {
        ratings: true,
        token: true,
      },
    });

    if (!ballots.length) {
      return res.redirect(`/admin/matches/${matchId}?error=noVotes`);
    }

    const stats = await prisma.playerStat.findMany({
      where: { matchId, present: true },
      include: { player: true },
    });

    if (!stats.length) {
      return res.redirect(`/admin/matches/${matchId}?error=noPresentPlayers`);
    }

    const ratingMap = new Map(); // playerId -> { sum, count }
    ballots.forEach((b) => {
      (b.ratings || []).forEach((r) => {
        if (!ratingMap.has(r.playerId)) ratingMap.set(r.playerId, { sum: 0, count: 0 });
        const entry = ratingMap.get(r.playerId);
        entry.sum += r.rating;
        entry.count += 1;
      });
    });

    const updates = [];
    stats.forEach((stat) => {
      if (stat.rating != null) return;
      const entry = ratingMap.get(stat.playerId);
      if (!entry || entry.count === 0) return;
      const avg = entry.sum / entry.count; // 1..5
      const finalRating = Math.max(0, Math.min(10, avg * 2));
      updates.push(
        prisma.playerStat.update({
          where: { id: stat.id },
          data: { rating: Number(finalRating.toFixed(2)) },
        })
      );
    });

    if (!updates.length) {
      return res.redirect(`/admin/matches/${matchId}?error=noRatingsToUpdate`);
    }

    await prisma.$transaction(updates);
    return res.redirect(`/admin/matches/${matchId}?applyVotes=true`);
  } catch (err) {
    console.error("Erro ao aplicar votos em notas:", err);
    return res.redirect(`/admin/matches/${matchId}?error=applyVotes`);
  }
});

// ===============================================
// ?? Rota: Recalcular totais de TODOS os jogadores
// ===============================================
async function handleRecalculateTotals(req, res) {
  try {
    console.log("?? Recalculando totais de todos os jogadores...");

    const players = await prisma.player.findMany({
      include: {
        stats: true,
      },
    });

    for (const player of players) {
      const stats = player.stats || [];

      const totalGoals = stats.reduce((sum, s) => sum + (s.goals || 0), 0);
      const totalAssists = stats.reduce((sum, s) => sum + (s.assists || 0), 0);
      const totalMatches = stats.filter((s) => s.present).length;
      const totalPhotos = stats.filter((s) => s.appearedInPhoto).length;

      const rated = stats.filter((s) => s.rating != null);
      const totalRating =
        rated.length > 0
          ? rated.reduce((sum, s) => sum + s.rating, 0) / rated.length
          : 0;

      await prisma.player.update({
        where: { id: player.id },
        data: {
          totalGoals,
          totalAssists,
          totalMatches,
          totalPhotos,
          totalRating,
        },
      });
    }

    console.log("? Totais recalculados com sucesso.");
    return res.redirect("/admin?success=totalsRecalculated");
  } catch (err) {
    console.error("Erro ao recalcular totais:", err);
    return res.status(500).send("Erro ao recalcular totais.");
  }
}

// Aceita QUALQUER m–todo (GET, POST, etc) nesse caminho
router.all("/recalculate-totals", requireAdmin, handleRecalculateTotals);


// ===============================================
// ?? Rota: Recalcular OVERALL (last 10)
// ===============================================
router.post("/recalculate-overall", requireAdmin, async (req, res) => {
  try {
    const { recalculateOverallForAllPlayers } = require("../utils/ranking");
    const { count } = await recalculateOverallForAllPlayers();
    
    // Adicionando um pequeno delay para o usuário perceber a a––o
    setTimeout(() => {
      res.redirect(`/admin?success=overallRecalculated&count=${count}`);
    }, 500);

  } catch (err) {
    console.error("Erro ao recalcular overall:", err);
    res.redirect("/admin?error=overallError");
  }
});



// ==============================
// ?? Sorteador de times (6 por time, usa OVERALL do ranking)
// ==============================

// Distribui––o "snake" para balancear times
function snakeDistribute(players, teamCount) {
    const teams = Array.from({ length: teamCount }, () => []);
    let playerIndex = 0;
    for (let round = 0; playerIndex < players.length; round++) {
        // Da esquerda pra direita
        if (round % 2 === 0) {
            for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
                if (playerIndex < players.length) {
                    teams[teamIdx].push(players[playerIndex++]);
                }
            }
        } else { // Da direita pra esquerda
            for (let teamIdx = teamCount - 1; teamIdx >= 0; teamIdx--) {
                if (playerIndex < players.length) {
                    teams[teamIdx].push(players[playerIndex++]);
                }
            }
        }
    }
    return teams;
}

function computeTeamPower(team) {
  return team.reduce((sum, p) => sum + (p.strength || 0), 0);
}

router.post("/matches/:id/sort-teams", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.status(400).json({ error: "matchId inválido" });
    const presentIds = Array.isArray(req.body.presentIds)
      ? req.body.presentIds
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n))
      : [];
    const seedIds = Array.isArray(req.body.seedIds)
      ? req.body.seedIds
          .map((id) => Number(id))
          .filter((n) => Number.isFinite(n))
      : [];

    // 1. Convidados
    const guestsRaw = req.body.guests || "";
    const guestEntries = guestsRaw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const [name, pos, str] = line.split(";").map((s) => (s || "").trim());
        const strength = Math.max(40, Math.min(100, parseInt(str || "60", 10) || 60));
        return {
          id: `guest-${idx}-${Date.now()}`,
          name: name || "Convidado",
          nickname: null,
          position: pos || "Outros",
          strength,
          guest: true,
        };
      });

    // 2. Jogadores presentes
    let stats;
    if (presentIds.length) {
      const playersPresent = await prisma.player.findMany({
        where: { id: { in: presentIds } },
      });
      stats = playersPresent.map((p) => ({
        playerId: p.id,
        player: p,
        present: true,
        goals: 0,
        assists: 0,
        rating: null,
      }));
    } else {
      stats = await prisma.playerStat.findMany({
        where: { matchId, present: true },
        include: { player: true },
      });
    }

    if (!stats.length && !guestEntries.length) {
      return res
        .status(400)
        .json({ error: "Nenhum jogador presente para sortear. Marque presenças (ou adicione convidados)." });
    }

    // 3. Overall dos presentes
    const playerIds = Array.from(new Set(stats.map((s) => s.playerId)));
    const basePlayers = await prisma.player.findMany({
      where: { id: { in: playerIds } },
    });

    const { computed } = computeOverallFromEntries(
      basePlayers.map((p) => ({
        player: p,
        goals: p.totalGoals || 0,
        assists: p.totalAssists || 0,
        matches: p.totalMatches || 0,
        rating: p.totalRating || 0,
      }))
    );
    const overallMap = new Map(computed.map((c) => [c.player.id, c.overall]));

    // 3.1 últimas 10 peladas de cada jogador presente (para balancear for–a recente)
    const recentStatsRaw = await prisma.playerStat.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { match: { playedAt: "desc" } },
      include: { match: true },
    });

    // Agrupa por jogador e pega s– os 10 jogos mais recentes
    const recentByPlayer = new Map();
    for (const s of recentStatsRaw) {
      if (!s.match || !s.match.playedAt) continue;
      if (!recentByPlayer.has(s.playerId)) recentByPlayer.set(s.playerId, []);
      if (recentByPlayer.get(s.playerId).length < 10) {
        recentByPlayer.get(s.playerId).push(s);
      }
    }

    // Maximos para normalizar gols/assist nas últimas 10
    let maxGoals10 = 0;
    let maxAssists10 = 0;
    recentByPlayer.forEach((arr) => {
      let g = 0;
      let a = 0;
      arr.forEach((s) => {
        g += s.goals || 0;
        a += s.assists || 0;
      });
      if (g > maxGoals10) maxGoals10 = g;
      if (a > maxAssists10) maxAssists10 = a;
    });

    const last10ScoreMap = new Map();
    const rating10Map = new Map();

    recentByPlayer.forEach((arr, playerId) => {
      let goals = 0;
      let assists = 0;
      let ratingSum = 0;
      let ratingCount = 0;

      arr.forEach((s) => {
        goals += s.goals || 0;
        assists += s.assists || 0;
        if (s.rating != null) {
          ratingSum += s.rating;
          ratingCount += 1;
        }
      });

      const ratingAvg = ratingCount > 0 ? ratingSum / ratingCount : 0;
      const goalsNorm = maxGoals10 > 0 ? (goals / maxGoals10) * 10 : 0;
      const assistsNorm = maxAssists10 > 0 ? (assists / maxAssists10) * 10 : 0;
      const ratingNorm = ratingAvg || 0; // j– em 0-10

      // Peso recente: rating 5, gols 3, assist 2 (0-10)
      const last10Score = (ratingNorm * 5 + goalsNorm * 3 + assistsNorm * 2) / 10;

      last10ScoreMap.set(playerId, last10Score);
      rating10Map.set(playerId, ratingAvg);
    });

    const players = stats.map((s) => ({
      id: s.player.id,
      name: s.player.name,
      nickname: s.player.nickname,
      position: s.player.position || "Outros",
      // for–a combinando overall histórico + desempenho recente (últimas 10)
      strength: (() => {
        const baseOverall = overallMap.get(s.playerId) ?? 60;
        const last10Score = last10ScoreMap.get(s.playerId) ?? 0; // 0-10
        const combined = Math.round(baseOverall * 0.6 + (last10Score * 10) * 0.4);
        return combined;
      })(),
      displayOverall: overallMap.get(s.playerId) ?? null,
      guest: false,
    }));

    // 4. Pool completo
    const fullPool = [...players, ...guestEntries];

    // 5. Separar goleiros e jogadores de linha
    const goalkeepers = [];
    const fieldPlayers = [];
    fullPool.forEach((p) => {
      const pos = (p.position || "").toLowerCase();
      const isGoalkeeper = pos.includes("goleiro") || pos.includes("gol");
      if (isGoalkeeper) {
        goalkeepers.push(p);
      } else {
        fieldPlayers.push(p);
      }
    });

    // 6. Validar n–mero m–nimo de jogadores (linha + goleiros)
    const MIN_PLAYERS_PER_TEAM = 6;
    const totalPlayers = fieldPlayers.length + guestEntries.length;
    const minPlayersForTwoTeams = MIN_PLAYERS_PER_TEAM * 2;
    if (totalPlayers < minPlayersForTwoTeams) {
      return res.status(400).json({ error: `S–o necess–rios pelo menos ${minPlayersForTwoTeams} jogadores para formar 2 times. Atualmente: ${totalPlayers}.` });
    }

    // 7. Definir quantos times e quantos v–o pro banco (m–x 4)
    const teamCount = Math.min(4, Math.floor(totalPlayers / MIN_PLAYERS_PER_TEAM));
    const playersPerTeam = MIN_PLAYERS_PER_TEAM;
    const totalPlayersForTeams = teamCount * playersPerTeam;

    // Goleiros ficam separados no banco (não entram no sorteio automático)
    const keepGoalkeepersOnBench = true;
    const teamPool = [...fieldPlayers, ...guestEntries];

    // 8. Ordenar por for–a para sorteio balanceado
    teamPool.sort((a, b) => b.strength - a.strength);

    // 8.1. Cabe–as de chave (mant–m um por time sempre que poss–vel)
    const seedSet = new Set(seedIds.map((id) => String(id)));
    const seedPool = [];
    const nonSeedPool = [];
    teamPool.forEach((p) => {
      if (seedSet.has(String(p.id))) seedPool.push(p);
      else nonSeedPool.push(p);
    });
    const orderedFieldPool = [...seedPool, ...nonSeedPool];

    // 9. Distribuir os jogadores de linha com seeds priorizadas
    const playersToDistribute = orderedFieldPool.slice(0, totalPlayersForTeams);
    const seedsForTeams = playersToDistribute
      .filter((p) => seedSet.has(String(p.id)))
      .slice(0, teamCount);
    const usedSeedIds = new Set(seedsForTeams.map((p) => String(p.id)));
    const remainingPlayers = playersToDistribute.filter((p) => !usedSeedIds.has(String(p.id)));

    const seededBuckets = Array.from({ length: teamCount }, () => []);
    seedsForTeams.forEach((p, idx) => {
      seededBuckets[idx % teamCount].push(p);
    });

    const autoBuckets = snakeDistribute(remainingPlayers, teamCount);
    const teamBuckets = seededBuckets.map((bucket, idx) => [...bucket, ...(autoBuckets[idx] || [])]);

    // 10. Goleiros no banco apenas se houver jogadores de linha suficientes

    // 11. Montar banco de reservas
    const leftoverFieldPlayers = orderedFieldPool.slice(totalPlayersForTeams);
    const bench = [
      ...(keepGoalkeepersOnBench ? goalkeepers : []),
      ...leftoverFieldPlayers,
    ].map((p) => ({
      ...p,
      displayOverall: overallMap.get(p.id) ?? null,
    }));
    bench.sort((a, b) => b.strength - a.strength);

    // 12. Finalizar e retornar
    const teams = teamBuckets.map((t, idx) => ({
      name: `Time ${idx + 1}`,
      power: computeTeamPower(t),
      players: t.map((p) => ({
        ...p,
        displayOverall: overallMap.get(p.id) ?? null,
      })),
    }));

    // 12. Persistir o sorteio mais recente para recarregar na tela depois
    try {
      await prisma.lineupDraw.create({
        data: {
          matchId,
          seed: crypto.randomBytes(8).toString("hex"),
          parameters: {
            presentIds: playerIds,
            guests: guestEntries,
            seeds: seedIds,
          },
          result: { teams, bench },
        },
      });
    } catch (persistErr) {
      console.error("Erro ao salvar sorteio (LineupDraw):", persistErr);
      // Não bloquear a resposta principal se o salvamento falhar
    }

    return res.json({ teams, bench });

  } catch (err) {
    console.error("Erro no sorteador:", err);
    return res.status(500).json({ error: err && err.message ? err.message : "Erro ao sortear times" });
  }
});

router.post("/matches/:id/save-lineup", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.status(400).json({ error: "matchId invalido" });

    const { teams, bench, source } = req.body || {};

    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: "Times invalidos para salvar." });
    }

    const normalizePlayer = (player, idx) => ({
      id: player?.id ?? `custom-${idx}-${Date.now()}`,
      name: player?.name || "Jogador",
      nickname: player?.nickname || null,
      position: player?.position || "",
      strength: Number.isFinite(Number(player?.strength)) ? Number(player.strength) : 0,
      guest: !!player?.guest,
    });

    const normalizedTeams = teams.map((team, idx) => {
      const players = Array.isArray(team?.players) ? team.players.map((p, pIdx) => normalizePlayer(p, pIdx)) : [];
      const power = players.reduce((sum, p) => sum + (p.strength || 0), 0);
      return {
        name: team?.name || `Time ${idx + 1}`,
        colorName: team?.colorName || null,
        colorValue: team?.colorValue || null,
        power,
        players,
      };
    });

    const normalizedBench = Array.isArray(bench) ? bench.map((p, idx) => normalizePlayer(p, idx)) : [];

    const saved = await prisma.lineupDraw.create({
      data: {
        matchId,
        seed: crypto.randomBytes(8).toString("hex"),
        parameters: { source: source || "manual-save" },
        result: {
          teams: normalizedTeams,
          bench: normalizedBench,
        },
      },
    });

    return res.json({ ok: true, lineupId: saved.id });
  } catch (err) {
    console.error("Erro ao salvar lineup manualmente:", err);
    return res.status(500).json({ error: "Erro ao salvar lineup" });
  }
});

// ==============================
// ?? Gerar link de votação p–blica para a pelada
// ==============================
router.post("/matches/:id/generate-voting-link", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const token = crypto.randomBytes(16).toString("hex");

    await prisma.match.update({
      where: { id: matchId },
      data: {
        votingToken: token,
        votingStatus: "OPEN",
      },
    });

    return res.redirect(`/admin/matches/${matchId}?votingLinkGenerated=true`);
  } catch (err) {
    console.error("Erro ao gerar link de votação:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=votingLink`);
  }
});

// ----------------------------------------------
// Helpers para cálculo de notas e prêmios
// ----------------------------------------------
router.post("/matches/:id/calculate-results", requireAdmin, async (req, res) => {
  const matchId = Number(req.params.id);
  if (Number.isNaN(matchId)) {
    return res.redirect("/admin");
  }

  try {
    const result = await computeMatchRatingsAndAwards(matchId);
    if (result.error) {
      return res.redirect(`/admin/matches/${matchId}?error=noVotes`);
    }

    if (!result.publicVotes || result.publicVotes.length === 0) {
      return res.redirect(`/admin/matches/${matchId}?error=noVotes`);
    }

    const updates = [];
    result.scores.forEach((score) => {
      updates.push(
        prisma.playerStat.update({
          where: { id: score.statId },
          data: { rating: score.finalRating },
        })
      );
    });

    if (updates.length) {
      await prisma.$transaction(updates);
    }

    await prisma.match.update({
      where: { id: matchId },
      data: { votingStatus: "CLOSED" },
    });

    return res.redirect(`/admin/matches/${matchId}?resultsCalculated=true`);
  } catch (err) {
    console.error("Erro ao calcular resultados da votação:", err);
    return res.redirect(`/admin/matches/${matchId}?error=results`);
  }
});

// ==============================
// ?? Card de prêmios da pelada
// ==============================
router.get("/matches/:id/awards-card", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.redirect("/admin");

    const result = await computeMatchRatingsAndAwards(matchId);
    if (result.error) return res.redirect(`/admin/matches/${matchId}?error=noVotes`);

    const scoresList = Array.from(result.scores.values()).map((s) => ({
      ...s,
      playerId: s.player.id,
    }));

    return res.render("awards_card", {
      layout: "layout",
      match,
      awards: result.awards,
      scores: scoresList,
    });
  } catch (err) {
    console.error("Erro ao exibir card de prêmios:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// ?? Página de resultados/prêmios da pelada (com bot–o de download)
// ==============================
router.get("/matches/:id/awards", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.redirect("/admin");

    const result = await computeMatchRatingsAndAwards(matchId);
    if (result.error) return res.redirect(`/admin/matches/${matchId}?error=noVotes`);

    const scoresList = Array.from(result.scores.values()).map((s) => ({
      ...s,
      playerId: s.player.id,
    }));

    return res.render("awards_results", {
      layout: "layout",
      match,
      awards: result.awards,
      scores: scoresList,
    });
  } catch (err) {
    console.error("Erro ao exibir resultados/prêmios:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// ?? Rebuild de conquistas para todos os jogadores
// ==============================
router.post("/rebuild-achievements", requireAdmin, async (req, res) => {
  try {
    await rebuildAchievementsForAllPlayers();
    return res.redirect("/admin?achievementsRebuilt=1");
  } catch (err) {
    console.error("Erro ao recalcular conquistas:", err);
    return res.redirect("/admin?error=achievements");
  }
});

module.exports = router;






