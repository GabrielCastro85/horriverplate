// routes/admin.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const {
  uploadPlayerPhoto,
  uploadWeeklyTeamPhoto,
} = require("../utils/upload");

// ==============================
// 🛡️ Middleware: exige admin logado
// ==============================
function requireAdmin(req, res, next) {
  if (!req.admin) {
    return res.redirect("/login");
  }
  next();
}

// ==============================
// 🔢 Helper: recomputar totais de jogadores (para alguns IDs)
// ==============================
async function recomputeTotalsForPlayers(playerIds) {
  const uniqueIds = Array.from(new Set(playerIds)).filter((id) => !!id);
  if (!uniqueIds.length) return;

  for (const id of uniqueIds) {
    const stats = await prisma.playerStat.findMany({
      where: { playerId: id },
    });

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

    await prisma.player.update({
      where: { id },
      data: {
        totalGoals: goals,
        totalAssists: assists,
        totalMatches: matches,
        totalPhotos: photos,
        totalRating: avgRating,
      },
    });
  }
}

// ==============================
// 🧭 Painel principal /admin
// ==============================
router.get("/", requireAdmin, async (req, res) => {
  try {
    const matches = await prisma.match.findMany({
      orderBy: { playedAt: "desc" },
    });

    // Agrupa peladas por mês/ano
    const groupedMatchesObj = matches.reduce((groups, match) => {
      const date = new Date(match.playedAt);
      const year = date.getFullYear();
      const month = date.toLocaleString("pt-BR", { month: "long" });
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

    res.render("admin", {
      title: "Painel do Admin",
      matches,
      groupedMatches,
      players,
      weeklyAwards,
      monthlyAwards,
    });
  } catch (err) {
    console.error("Erro ao carregar painel admin:", err);
    res.status(500).send("Erro ao carregar painel do admin.");
  }
});

// ==============================
// 👤 Jogadores - CRUD
// ==============================

// Adicionar jogador (com upload de foto)
router.post(
  "/players",
  requireAdmin,
  uploadPlayerPhoto.single("photo"),
  async (req, res) => {
    try {
      const { name, nickname, position } = req.body;

      if (!name || !position) {
        return res.redirect("/admin");
      }

      let photoUrl = null;
      if (req.file) {
        photoUrl = `/uploads/players/${req.file.filename}`;
      }

      await prisma.player.create({
        data: {
          name,
          nickname: nickname || null,
          position,
          photoUrl,
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

// Editar jogador
router.post("/players/:id/edit", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, nickname, position } = req.body;

    if (!name || !position || Number.isNaN(id)) {
      return res.redirect("/admin");
    }

    await prisma.player.update({
      where: { id },
      data: {
        name,
        nickname: nickname || null,
        position,
      },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao editar jogador:", err);
    res.redirect("/admin");
  }
});

// Excluir jogador
router.post("/players/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");

    // Apaga stats do jogador antes (por segurança)
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
// 🏆 Peladas (Matches) - CRUD
// ==============================

// Criar nova pelada
router.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { playedAt, description, winnerTeam } = req.body;

    if (!playedAt) {
      return res.redirect("/admin");
    }

    await prisma.match.create({
      data: {
        playedAt: new Date(playedAt),
        description: description || null,
        winnerTeam: winnerTeam || null,
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
    const { playedAt, description, winnerTeam } = req.body;

    if (Number.isNaN(id) || !playedAt) {
      return res.redirect("/admin");
    }

    await prisma.match.update({
      where: { id },
      data: {
        playedAt: new Date(playedAt),
        description: description || null,
        winnerTeam: winnerTeam || null,
      },
    });

    res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao editar pelada:", err);
    res.redirect("/admin");
  }
});

// Excluir pelada (apaga stats primeiro)
router.post("/matches/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin");
    }

    // 1) apaga todas as stats ligadas a essa pelada
    await prisma.playerStat.deleteMany({
      where: { matchId: id },
    });

    // 2) agora pode apagar a pelada em si
    await prisma.match.delete({
      where: { id },
    });

    return res.redirect("/admin");
  } catch (err) {
    console.error("Erro ao excluir pelada:", err);
    return res.redirect("/admin");
  }
});

// ==============================
// 🔁 Selecionar pelada para lançar stats
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
// 💾 Salvar estatísticas em massa da pelada
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

    // Recalcula totais para ranking
    await recomputeTotalsForPlayers(Array.from(touchedPlayerIds));

    res.redirect(`/admin/matches/${matchId}`);
  } catch (err) {
    console.error("Erro ao salvar estatísticas da pelada:", err);
    res.redirect(`/admin/matches/${req.params.id}`);
  }
});

// ==============================
// 🏅 Destaques (semana / mês)
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
// 📊 Ver estatísticas de uma pelada (ADMIN)
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
      },
    });

    if (!match) {
      return res.redirect("/admin");
    }

    const players = await prisma.player.findMany({
      orderBy: { name: "asc" },
    });

    res.render("admin_match", {
      title: "Estatísticas da pelada",
      match,
      players,
      stats: match.stats || [],
    });
  } catch (err) {
    console.error("Erro ao carregar estatísticas da pelada:", err);
    res.redirect("/admin");
  }
});

// ===============================================
// 🔁 Rota: Recalcular totais de TODOS os jogadores
// ===============================================
async function handleRecalculateTotals(req, res) {
  try {
    console.log("🔁 Recalculando totais de todos os jogadores...");

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

    console.log("✅ Totais recalculados com sucesso.");
    return res.redirect("/admin?success=totalsRecalculated");
  } catch (err) {
    console.error("Erro ao recalcular totais:", err);
    return res.status(500).send("Erro ao recalcular totais.");
  }
}

// Aceita QUALQUER método (GET, POST, etc) nesse caminho
router.all("/recalculate-totals", requireAdmin, handleRecalculateTotals);

module.exports = router;
