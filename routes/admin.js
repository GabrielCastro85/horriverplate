// routes/admin.js
const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const prisma = require("../utils/db");
const {
  uploadPlayerPhoto,
  uploadWeeklyTeamPhoto,
} = require("../utils/upload");

const { computeOverallFromEntries } = require("../utils/overall");

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

    // Premiações de temporada (para exibir resuminho se quiser)
    const seasonAwards = await prisma.seasonAward.findMany({
      include: { player: true },
      orderBy: [{ year: "desc" }, { category: "asc" }],
    });

    res.render("admin", {
      title: "Painel do Admin",
      matches,
      groupedMatches,
      players,
      weeklyAwards,
      monthlyAwards,
      seasonAwards,
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
      const { name, nickname, position, whatsapp } = req.body;

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

      await prisma.player.create({
        data: {
          name,
          nickname: nickname || null,
          position,
          whatsapp: formattedWhatsapp,
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
    console.error("Erro ao carregar página de edição de jogador:", err);
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
      const { name, nickname, position, whatsapp } = req.body;

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

      // Se enviou nova foto, atualiza photoUrl; caso contrário, mantém a atual
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
// 🏆 Peladas (Matches) - CRUD
// ==============================

// Criar nova pelada
router.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { playedAt, description, winnerTeam } = req.body;

    const playedDate = playedAt ? new Date(playedAt) : null;
    if (!playedDate || Number.isNaN(playedDate.getTime())) {
      return res.redirect("/admin");
    }

    await prisma.match.create({
      data: {
        playedAt: playedDate,
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

    const playedDate = playedAt ? new Date(playedAt) : null;
    if (Number.isNaN(id) || !playedDate || Number.isNaN(playedDate.getTime())) {
      return res.redirect("/admin");
    }

    await prisma.match.update({
      where: { id },
      data: {
        playedAt: playedDate,
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
        bestOverallPlayer: true,
        rankings: { include: { player: true } },
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
// 🏆 Premiação da temporada (SeasonAward)
// ==============================

// Tela de gestão da premiação
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

    // 🔧 NÃO usamos mais year_category (não existe no schema).
    // Então buscamos primeiro, depois fazemos update OU create.
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

    // Overall de cada jogador (mesma métrica do ranking)
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

    res.render("admin_match", {
      title: "Estatísticas da pelada",
      match,
      players: playersWithOverall,
      stats: match.stats || [],
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
// Votações privadas por link (admin)
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
        rankings: true,
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

    // Mapa de quantos jogadores por posição (para normalizar ranking)
    const posCounts = new Map();
    stats.forEach((s) => {
      const pos = (s.player.position || "Outros").toLowerCase();
      posCounts.set(pos, (posCounts.get(pos) || 0) + 1);
    });

    // Score de ranking por jogador
    const rankScores = new Map(); // playerId -> [scores]
    ballots.forEach((b) => {
      const byPos = new Map();
      (b.rankings || []).forEach((r) => {
        const pos = (r.position || "Outros").toLowerCase();
        if (!byPos.has(pos)) byPos.set(pos, []);
        byPos.get(pos).push(r);
      });
      byPos.forEach((list, pos) => {
        const totalInPos = posCounts.get(pos) || list.length || 1;
        list.forEach((r) => {
          const denom = Math.max(totalInPos - 1, 1);
          const score = (totalInPos - r.rank) / denom; // 1 para 1º, 0 para último
          if (!rankScores.has(r.playerId)) rankScores.set(r.playerId, []);
          rankScores.get(r.playerId).push(score);
        });
      });
    });

    // Contagem de votos para "melhor da pelada"
    const mvpCounts = new Map();
    ballots.forEach((b) => {
      if (b.bestOverallPlayerId) {
        mvpCounts.set(
          b.bestOverallPlayerId,
          (mvpCounts.get(b.bestOverallPlayerId) || 0) + 1
        );
      }
    });
    const maxMvp = mvpCounts.size ? Math.max(...mvpCounts.values()) : 0;
    const mvpWinners = new Set(
      Array.from(mvpCounts.entries())
        .filter(([, v]) => v === maxMvp)
        .map(([id]) => id)
    );

    const updates = [];
    stats.forEach((stat) => {
      const pos = (stat.player.position || "Outros").toLowerCase();
      const rankList = rankScores.get(stat.playerId) || [];
      const rankAvg =
        rankList.length > 0
          ? rankList.reduce((a, b) => a + b, 0) / rankList.length // 0..1
          : 0;

      const mvpScore = mvpCounts.has(stat.playerId)
        ? mvpWinners.has(stat.playerId)
          ? 1 // campeão de MVP
          : 0.5 // recebeu votos de MVP
        : 0;

      const isGoalkeeper = pos.includes("goleiro");
      const goalWeight = isGoalkeeper ? 0.2 : 0.5;
      const assistWeight = isGoalkeeper ? 0.15 : 0.35;
      const photoWeight = isGoalkeeper ? 0.25 : 0.2;
      const statsRaw =
        (stat.goals || 0) * goalWeight +
        (stat.assists || 0) * assistWeight +
        (stat.appearedInPhoto ? photoWeight : 0);
      const maxStats = isGoalkeeper ? 1.0 : 1.5;
      const statsScore = Math.min(statsRaw / maxStats, 1); // 0..1

      // Peso total soma 1.0. Só dá 10 se rank for perfeito e for MVP de todos.
      const weighted =
        rankAvg * 0.6 +
        mvpScore * 0.3 +
        statsScore * 0.1;

      // Base fixa de 2.0
      let finalRating = Math.max(0, Math.min(10, 2 + weighted * 8));

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


// ===============================================
// 🔁 Rota: Recalcular OVERALL (last 10)
// ===============================================
router.post("/recalculate-overall", requireAdmin, async (req, res) => {
  try {
    const { recalculateOverallForAllPlayers } = require("../utils/ranking");
    const { count } = await recalculateOverallForAllPlayers();
    
    // Adicionando um pequeno delay para o usuário perceber a ação
    setTimeout(() => {
      res.redirect(`/admin?success=overallRecalculated&count=${count}`);
    }, 500);

  } catch (err) {
    console.error("Erro ao recalcular overall:", err);
    res.redirect("/admin?error=overallError");
  }
});



// ==============================
// 🧠 Sorteador de times (6 por time, usa OVERALL do ranking)
// ==============================

// Distribuição "snake" para balancear times
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

    // 3.1 Últimas 10 peladas de cada jogador presente (para balancear força recente)
    const recentStatsRaw = await prisma.playerStat.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { match: { playedAt: "desc" } },
      include: { match: true },
    });

    // Agrupa por jogador e pega só os 10 jogos mais recentes
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
      const ratingNorm = ratingAvg || 0; // já em 0-10

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
      // força combinando overall histórico + desempenho recente (últimas 10)
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
      if ((p.position || "").toLowerCase().includes("goleiro")) {
        goalkeepers.push(p);
      } else {
        fieldPlayers.push(p);
      }
    });

    // 6. Validar número mínimo de jogadores de linha
    const MIN_PLAYERS_PER_TEAM = 6;
    const requiredFieldPlayers = MIN_PLAYERS_PER_TEAM * 2;
    if (fieldPlayers.length < requiredFieldPlayers) {
      return res.status(400).json({ error: `São necessários pelo menos ${requiredFieldPlayers} jogadores de linha para formar 2 times. Atualmente: ${fieldPlayers.length}.` });
    }

    // 7. Definir quantos times e quantos vão pro banco
    const teamCount = Math.floor(fieldPlayers.length / MIN_PLAYERS_PER_TEAM);
    const playersPerTeam = MIN_PLAYERS_PER_TEAM;
    const totalPlayersForTeams = teamCount * playersPerTeam;

    // 8. Ordenar por força para sorteio balanceado
    fieldPlayers.sort((a, b) => b.strength - a.strength);

    // 9. Distribuir os jogadores de linha
    const playersToDistribute = fieldPlayers.slice(0, totalPlayersForTeams);
    const teamBuckets = snakeDistribute(playersToDistribute, teamCount);

    // 10. Opcional: distribuir goleiros se houver exatamente um por time
    let keepGoalkeepersOnBench = true;
    if (goalkeepers.length && goalkeepers.length === teamCount) {
      keepGoalkeepersOnBench = false;
      // embaralha levemente para não fixar sempre a mesma ordem
      const shuffledGks = [...goalkeepers].sort(() => Math.random() - 0.5);
      shuffledGks.forEach((gk, idx) => {
        teamBuckets[idx].unshift({
          ...gk,
          displayOverall: overallMap.get(gk.id) ?? null,
        });
      });
    }
    
    // 11. Montar banco de reservas
    const leftoverFieldPlayers = fieldPlayers.slice(totalPlayersForTeams);
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
          },
          result: { teams, bench },
        },
      });
    } catch (persistErr) {
      console.error("Erro ao salvar sorteio (LineupDraw):", persistErr);
      // NÆo bloquear a resposta principal se o salvamento falhar
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
// 🔗 Gerar link de votação pública para a pelada
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

        // We don't return the link directly, the view will build it.

        // We just signal that it was successful.

        return res.redirect(`/admin/matches/${matchId}?votingLinkGenerated=true`);

      } catch (err) {

        console.error("Erro ao gerar link de votação:", err);

        return res.redirect(`/admin/matches/${req.params.id}?error=votingLink`);

      }

    });

    

    // ==============================

    // 🧮 Calcular resultados da votação pública

    // ==============================

    router.post("/matches/:id/calculate-results", requireAdmin, async (req, res) => {

      const matchId = Number(req.params.id);

      if (Number.isNaN(matchId)) {

        return res.redirect("/admin");

      }

    

      try {

        const [publicVotes, playerStats] = await Promise.all([

          prisma.publicVote.findMany({

            where: { matchId },

            include: { rankings: true },

          }),

          prisma.playerStat.findMany({

            where: { matchId, present: true },

            include: { player: true },

          }),

        ]);

    

        if (publicVotes.length === 0) {

          return res.redirect(`/admin/matches/${matchId}?error=noVotes`);

        }

    

        const finalScores = new Map();

        playerStats.forEach(stat => {

          finalScores.set(stat.playerId, { base: 5.0, mvp: 0, ranking: 0, stats: 0, statId: stat.id });

        });

    

        // 1. Stats Score (Max variável por posição, com pesos por posição)
        playerStats.forEach((stat) => {
          const score = finalScores.get(stat.playerId);
          if (!score) return;

          const pos = (stat.player.position || "").toLowerCase();

          let goalW = 0.45;
          let assistW = 0.35;
          let photoW = 0.4;
          let maxStats = 1.2;

          if (pos.includes("goleiro")) {
            goalW = 0.15;
            assistW = 0.25;
            photoW = 0.8;
            maxStats = 1.0;
          } else if (pos.includes("zagueiro")) {
            goalW = 0.25;
            assistW = 0.25;
            photoW = 0.7;
            maxStats = 1.0;
          } else if (pos.includes("meia") || pos.includes("volante")) {
            goalW = 0.35;
            assistW = 0.35;
            photoW = 0.5;
            maxStats = 1.2;
          } else {
            // atacante / ponta / default
            goalW = 0.45;
            assistW = 0.35;
            photoW = 0.4;
            maxStats = 1.2;
          }

          let statPoints = 0;
          statPoints += (stat.goals || 0) * goalW;
          statPoints += (stat.assists || 0) * assistW;

          if (stat.appearedInPhoto) {
            statPoints += photoW;
          }

          score.stats = Math.min(statPoints, maxStats);
        });

    

        // 2. MVP Score (Max 1.5)

        const mvpVotes = publicVotes.map(v => v.mvpPlayerId).filter(id => id != null);

        if (mvpVotes.length > 0) {

            const mvpCounts = mvpVotes.reduce((acc, id) => {

                acc[id] = (acc[id] || 0) + 1;

                return acc;

            }, {});

            

            const maxVotes = Math.max(...Object.values(mvpCounts));

            const winners = Object.keys(mvpCounts).filter(id => mvpCounts[id] === maxVotes);

    

            winners.forEach(winnerId => {

                const id = Number(winnerId);

                if (finalScores.has(id)) {

                    finalScores.get(id).mvp = 1.5 / winners.length; // Share the bonus if tied

                }

            });

    

            // Bonus for receiving votes

            Object.keys(mvpCounts).forEach(voterId => {

                const id = Number(voterId);

                if (finalScores.has(id) && !winners.includes(voterId)) {

                     finalScores.get(id).mvp += 0.25;

                }

            });

        }

    

        // 3. Ranking Score (Max 2.0)

        const rankingScores = new Map(); // playerId -> [scores]

        publicVotes.forEach(vote => {

          const rankingsByPos = vote.rankings.reduce((acc, r) => {

            if (!acc[r.position]) acc[r.position] = [];

            acc[r.position].push(r);

            return acc;

          }, {});

    

          Object.values(rankingsByPos).forEach(ranks => {

            const numPlayers = ranks.length;

            if(numPlayers < 2) return;

            ranks.forEach(rank => {

              const score = (numPlayers - rank.rank) / (numPlayers - 1); // 1 for 1st, 0 for last

              if (!rankingScores.has(rank.playerId)) rankingScores.set(rank.playerId, []);

              rankingScores.get(rank.playerId).push(score);

            });

          });

        });

    

        rankingScores.forEach((scores, playerId) => {

          if (finalScores.has(playerId)) {

            const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

            finalScores.get(playerId).ranking = avg * 2.0; // Scale to max 2 points

          }

        });

    

        // 4. Final calculation and DB update prep

        const updates = [];

        finalScores.forEach((score, playerId) => {

          let finalScore = score.base + score.mvp + score.ranking + score.stats;

          finalScore = Math.min(Math.max(finalScore, 0), 10);

          

          updates.push(

            prisma.playerStat.update({

              where: { id: score.statId },

              data: { rating: parseFloat(finalScore.toFixed(2)) },

            })

          );

        });

    

        await prisma.$transaction(updates);

    

        await prisma.match.update({

          where: { id: matchId },

          data: { votingStatus: 'CLOSED' },

        });

    

        res.redirect(`/admin/matches/${matchId}?resultsCalculated=true`);

    

      } catch (err) {

        console.error("Erro ao calcular resultados da votação:", err);

        res.redirect(`/admin/matches/${matchId}?error=results`);

      }

    });

    

    

    module.exports = router;
