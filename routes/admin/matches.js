const express = require("express");
const crypto = require("crypto");
const prisma = require("../../utils/db");
const { computeMatchRatingsAndAwards } = require("../../utils/match_ratings");
const { captureAwardsCardPng } = require("./reports");
const { recomputeTotalsForPlayers, updateAllPlayersOverallAfterMatch } = require("./shared");
const { recalculateOverallForAllPlayers } = require("../../utils/ranking");
const { ensureFinanceSettings } = require("../../services/financePage.service");
const { syncMonthlyFeeForPlayerCompetence } = require("../../services/financeAutomation.service");
const {
  decorateWeeklyVoteBallot,
  isWeeklyVoteBallotValid,
} = require("../../helpers/weeklyVoteValidation.helper");
const { deleteCache } = require("../../utils/page_cache");
const { getDynamicOverallSnapshot } = require("../../utils/live_overall");
const { uploadWeeklyTeamPhoto } = require("../../utils/upload");
const { formatDateBR } = require("../../utils/finance");
const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.admin) return res.redirect("/login");
  next();
}

// ==============================
// Match / tournament helpers
// ==============================

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

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function isGoalkeeperPosition(position) {
  const value = String(position || "").toLowerCase();
  return value.includes("gol") || value.includes("goleir") || value.includes("goal");
}

async function saveMatchStatsFromBody(matchId, body) {
  const [players, existingStats, match] = await Promise.all([
    prisma.player.findMany(),
    prisma.playerStat.findMany({
      where: { matchId },
    }),
    prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, playedAt: true },
    }),
  ]);

  if (!match) {
    return { error: "matchNotFound" };
  }

  const statsByPlayerId = new Map();
  for (const stat of existingStats) {
    statsByPlayerId.set(stat.playerId, stat);
  }

  const touchedPlayerIds = new Set();

  for (const player of players) {
    const playerId = player.id;
    touchedPlayerIds.add(playerId);

    const present = !!body[`present_${playerId}`];

    const goalsRaw = body[`goals_${playerId}`];
    const assistsRaw = body[`assists_${playerId}`];
    const savesRaw = body[`saves_${playerId}`];
    const hasSavesField = Object.prototype.hasOwnProperty.call(body, `saves_${playerId}`);
    const hasRatingField = Object.prototype.hasOwnProperty.call(body, `rating_${playerId}`);
    const ratingRaw = hasRatingField ? body[`rating_${playerId}`] : "";
    const photo = !!body[`photo_${playerId}`];

    let goals = goalsRaw ? parseInt(goalsRaw, 10) || 0 : 0;
    let assists = assistsRaw ? parseInt(assistsRaw, 10) || 0 : 0;
    let saves = null;
    if (isGoalkeeperPosition(player.position) && hasSavesField && String(savesRaw ?? "").trim() !== "") {
      saves = Math.max(0, parseInt(savesRaw, 10) || 0);
    }

    let rating = null;
    if (ratingRaw && ratingRaw.trim() !== "") {
      const normalized = ratingRaw.replace(",", ".");
      const parsed = parseFloat(normalized);
      if (!Number.isNaN(parsed)) {
        rating = parsed;
      }
    }

    let appearedInPhoto = photo;

    if (!present) {
      goals = 0;
      assists = 0;
      saves = null;
      rating = null;
      appearedInPhoto = false;
    } else if (!hasRatingField) {
      rating = statsByPlayerId.get(playerId)?.rating ?? null;
    }

    const hasAnyData =
      present || goals > 0 || assists > 0 || saves !== null || rating !== null || appearedInPhoto;

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
          saves,
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
          saves,
          rating,
          appearedInPhoto,
        },
      });
    }
  }

  await recomputeTotalsForPlayers(Array.from(touchedPlayerIds));
  await recalculateOverallForAllPlayers();
  await updateAllPlayersOverallAfterMatch(matchId);

  const financeSettings = await ensureFinanceSettings();
  const matchDate = new Date(match.playedAt);
  const matchMonth = matchDate.getUTCMonth() + 1;
  const matchYear = matchDate.getUTCFullYear();
  const touchedPlayers = players.filter(
    (player) =>
      touchedPlayerIds.has(player.id) &&
      player.financeActive &&
      player.isMonthlyMember &&
      String(player.financeParticipantType || "MONTHLY").toUpperCase() !== "GUEST"
  );

  for (const player of touchedPlayers) {
    await syncMonthlyFeeForPlayerCompetence({
      prisma,
      player,
      settings: financeSettings,
      month: matchMonth,
      year: matchYear,
      referenceDate: new Date(),
    });
  }

  if (Object.prototype.hasOwnProperty.call(body, "winnerColor")) {
    const winnerColor = (body.winnerColor || "").trim();
    await prisma.match.update({
      where: { id: matchId },
      data: { winnerColor: winnerColor || null },
    });
  }

  return { match, players, touchedPlayerIds: Array.from(touchedPlayerIds) };
}

// ==============================
// Sort-teams helpers
// ==============================

function snakeDistribute(players, teamCount) {
  const teams = Array.from({ length: teamCount }, () => []);
  let playerIndex = 0;
  for (let round = 0; playerIndex < players.length; round++) {
    if (round % 2 === 0) {
      for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
        if (playerIndex < players.length) {
          teams[teamIdx].push(players[playerIndex++]);
        }
      }
    } else {
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

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bucketShuffle(arr, bucketSize) {
  if (!Array.isArray(arr) || bucketSize <= 1) return arr.slice();
  const out = [];
  for (let i = 0; i < arr.length; i += bucketSize) {
    const bucket = arr.slice(i, i + bucketSize);
    shuffleInPlace(bucket);
    out.push(...bucket);
  }
  return out;
}

function lineupSignature(teams) {
  const teamKeys = (teams || []).map((team) => {
    const players = Array.isArray(team?.players) ? team.players : [];
    const ids = players.map((p) =>
      p?.guest
        ? `guest:${String(p?.name || "").trim().toLowerCase()}`
        : `player:${String(p?.id ?? "")}`
    );
    ids.sort();
    return ids.join(",");
  });
  teamKeys.sort();
  return teamKeys.join("|");
}

// ==============================
// Match CRUD routes
// ==============================

router.post("/matches", requireAdmin, async (req, res) => {
  try {
    const { playedAt, playedDate, playedTime, description, winnerTeam, winnerColor } = req.body;

    const playedDateValue = parsePlayedAt({ playedAt, playedDate, playedTime });
    if (!playedDateValue) {
      return res.redirect("/admin");
    }

    const createdMatch = await prisma.match.create({
      data: {
        playedAt: playedDateValue,
        description: description || null,
        winnerTeam: winnerTeam || null,
        winnerColor: winnerColor || null,
      },
    });

    res.redirect(`/admin/matches/${createdMatch.id}?openDialog=presence`);
  } catch (err) {
    console.error("Erro ao criar pelada:", err);
    res.redirect("/admin");
  }
});

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

// ==============================
// Tournament routes
// ==============================

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

router.post("/matches/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.redirect("/admin");
    }

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
// Votes management
// ==============================

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

    const ballotsRaw = await prisma.voteBallot.findMany({
      where: { token: { session: { matchId: id } } },
      include: {
        token: { include: { player: true } },
        ratings: { include: { player: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const ballots = ballotsRaw.map((ballot) => decorateWeeklyVoteBallot(ballot));
    const invalidByCode = ballots.reduce((acc, ballot) => {
      const code = ballot.voteValidation?.invalidCode;
      if (!code) return acc;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});

    return res.render("admin_votes", {
      title: "Votos da pelada",
      match,
      session,
      ballots,
      voteIntegritySummary: {
        totalBallots: ballots.length,
        invalidBallots: ballots.filter((ballot) => ballot.voteValidation?.isInvalid).length,
        validBallots: ballots.filter((ballot) => !ballot.voteValidation?.isInvalid).length,
        invalidByCode,
      },
      voteDeleted: req.query.voteDeleted === "1",
      voteValidated: req.query.voteValidated === "1",
      voteDeleteError: req.query.voteDeleteError || null,
      voteValidateError: req.query.voteValidateError || null,
    });
  } catch (err) {
    console.error("Erro ao listar votos da pelada:", err);
    return res.redirect("/admin");
  }
});

router.post("/matches/:id/votes/:ballotId/validate", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    const ballotId = Number(req.params.ballotId);
    if (Number.isNaN(matchId) || Number.isNaN(ballotId)) {
      return res.redirect("/admin");
    }

    const ballot = await prisma.voteBallot.findUnique({
      where: { id: ballotId },
      include: {
        token: {
          include: {
            session: true,
          },
        },
        ratings: true,
      },
    });

    if (!ballot || !ballot.token || ballot.token.session?.matchId !== matchId) {
      return res.redirect(`/admin/matches/${matchId}/votes?voteValidateError=notFound`);
    }

    const decoratedBallot = decorateWeeklyVoteBallot(ballot);
    if (!decoratedBallot.voteValidation?.isInvalid) {
      return res.redirect(`/admin/matches/${matchId}/votes?voteValidateError=alreadyValid`);
    }

    await prisma.voteBallot.update({
      where: { id: ballotId },
      data: {
        isInvalid: false,
        validatedManually: true,
        validatedManuallyAt: new Date(),
      },
    });

    return res.redirect(`/admin/matches/${matchId}/votes?voteValidated=1`);
  } catch (err) {
    console.error("Erro ao validar voto manualmente:", err);
    return res.redirect(`/admin/matches/${req.params.id}/votes?voteValidateError=server`);
  }
});

router.post("/matches/:id/votes/:ballotId/delete", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    const ballotId = Number(req.params.ballotId);
    if (Number.isNaN(matchId) || Number.isNaN(ballotId)) {
      return res.redirect("/admin");
    }

    const ballot = await prisma.voteBallot.findUnique({
      where: { id: ballotId },
      include: {
        token: {
          include: {
            session: true,
            player: true,
          },
        },
      },
    });

    if (!ballot || !ballot.token || ballot.token.session?.matchId !== matchId) {
      return res.redirect(`/admin/matches/${matchId}/votes?voteDeleteError=notFound`);
    }

    await prisma.$transaction(async (tx) => {
      await tx.voteRanking.deleteMany({
        where: { voteBallotId: ballotId },
      });
      await tx.voteRating.deleteMany({
        where: { voteBallotId: ballotId },
      });
      await tx.voteBallot.delete({
        where: { id: ballotId },
      });
      await tx.voteToken.update({
        where: { id: ballot.voteTokenId },
        data: { usedAt: null },
      });
    });

    return res.redirect(`/admin/matches/${matchId}/votes?voteDeleted=1`);
  } catch (err) {
    console.error("Erro ao excluir voto da pelada:", err);
    return res.redirect(`/admin/matches/${req.params.id}/votes?voteDeleteError=server`);
  }
});

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
// Presence and stats
// ==============================

router.post("/matches/:id/presence", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const [players, existingStats, match] = await Promise.all([
      prisma.player.findMany(),
      prisma.playerStat.findMany({
        where: { matchId },
      }),
      prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, playedAt: true },
      }),
    ]);

    if (!match) {
      return res.redirect("/admin");
    }

    const statsByPlayerId = new Map(existingStats.map((stat) => [stat.playerId, stat]));

    for (const player of players) {
      const isPresent = !!req.body[`present_${player.id}`];
      const existingStat = statsByPlayerId.get(player.id);

      if (isPresent) {
        if (existingStat) {
          if (!existingStat.present) {
            await prisma.playerStat.update({
              where: { id: existingStat.id },
              data: { present: true },
            });
          }
        } else {
          await prisma.playerStat.create({
            data: {
              playerId: player.id,
              matchId,
              present: true,
              goals: 0,
              assists: 0,
              rating: null,
              appearedInPhoto: false,
            },
          });
        }
        continue;
      }

      if (existingStat) {
        await prisma.playerStat.delete({
          where: { id: existingStat.id },
        });
      }
    }

    const touchedPlayerIds = players.map((player) => player.id);
    await recomputeTotalsForPlayers(touchedPlayerIds);
    await recalculateOverallForAllPlayers();

    const financeSettings = await ensureFinanceSettings();
    const matchDate = new Date(match.playedAt);
    const matchMonth = matchDate.getUTCMonth() + 1;
    const matchYear = matchDate.getUTCFullYear();
    const touchedPlayers = players.filter(
      (player) =>
        player.financeActive &&
        player.isMonthlyMember &&
        String(player.financeParticipantType || "MONTHLY").toUpperCase() !== "GUEST"
    );

    for (const player of touchedPlayers) {
      await syncMonthlyFeeForPlayerCompetence({
        prisma,
        player,
        settings: financeSettings,
        month: matchMonth,
        year: matchYear,
        referenceDate: new Date(),
      });
    }

    res.redirect(`/admin/matches/${matchId}#stats`);
  } catch (err) {
    console.error("Erro ao salvar presencas da pelada:", err);
    res.redirect(`/admin/matches/${req.params.id}`);
  }
});

router.post("/matches/:id/stats/bulk", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) {
      return res.redirect("/admin");
    }

    const result = await saveMatchStatsFromBody(matchId, req.body);
    if (result.error) {
      return res.redirect("/admin");
    }

    res.redirect(`/admin/matches/${matchId}`);
  } catch (err) {
    console.error("Erro ao salvar estatisticas da pelada:", err);
    res.redirect(`/admin/matches/${req.params.id}`);
  }
});

// ==============================
// Match detail and vote session
// ==============================

router.get("/matches/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.redirect("/admin");
    const openDialog = String(req.query.openDialog || "").trim().toLowerCase();

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

    const { scoreMap: overallById } = await getDynamicOverallSnapshot();
    const playersWithOverall = players.map((p) => ({
      ...p,
      overall: p.overallDynamic ?? overallById.get(p.id) ?? 60,
    }));

    const voteSession = match.voteSessions.length > 0 ? match.voteSessions[0] : null;
    const voteBaseUrl = `${req.protocol}://${req.get("host")}`;

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
          if (score.votesCount > 0) {
            finalMap.set(score.player.id, score.finalRating);
          }
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
      voteSession,
      voteBaseUrl,
      openDialog,
      req,
      lineupResult: lastLineupDraw ? lastLineupDraw.result : null,
    });
  } catch (err) {
    console.error("Erro ao carregar estatísticas da pelada:", err);
    res.redirect("/admin");
  }
});

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

    const result = await computeMatchRatingsAndAwards(matchId);
    if (
      !result.error &&
      result.publicVotes &&
      result.publicVotes.length &&
      result.awards &&
      result.awards.craque &&
      result.awards.craque.player
    ) {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true, playedAt: true },
      });
      if (match) {
        const weekStart = getWeekStart(match.playedAt);
        const existing = await prisma.weeklyAward.findFirst({ where: { weekStart } });
        const bestPlayerId = result.awards.craque.player.id;
        if (existing) {
          await prisma.weeklyAward.update({
            where: { id: existing.id },
            data: {
              bestPlayer: { connect: { id: bestPlayerId } },
              winningMatch: { connect: { id: matchId } },
            },
          });
        } else {
          await prisma.weeklyAward.create({
            data: {
              weekStart,
              bestPlayer: { connect: { id: bestPlayerId } },
              winningMatch: { connect: { id: matchId } },
            },
          });
        }
        deleteCache("home");
      }
    }

    const redirectTo = typeof req.body?.redirectTo === "string" ? req.body.redirectTo : "";
    if (redirectTo.startsWith(`/admin/matches/${matchId}/awards`)) {
      return res.redirect(redirectTo);
    }
    return res.redirect(`/admin/matches/${matchId}?votesClosed=true`);
  } catch (err) {
    console.error("Erro ao encerrar votação:", err);
    return res.redirect(`/admin/matches/${req.params.id}?error=closeVotes`);
  }
});

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

    const ballotsRaw = await prisma.voteBallot.findMany({
      where: { token: { voteSessionId: session.id } },
      include: {
        ratings: true,
        token: true,
      },
    });
    const ballots = ballotsRaw.filter((ballot) => isWeeklyVoteBallotValid(ballot));

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

    const ratingMap = new Map();
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
      const entry = ratingMap.get(stat.playerId);
      if (!entry || entry.count === 0) return;
      const avg = entry.sum / entry.count;
      const voteRating = Math.max(0, Math.min(10, avg * 2));
      const manualRating =
        stat.rating != null && !Number.isNaN(Number(stat.rating))
          ? Number(stat.rating)
          : null;
      const combined =
        manualRating != null
          ? voteRating * 0.7 + manualRating * 0.3
          : voteRating;
      const finalRating = Math.max(0, Math.min(10, combined));
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
    await recomputeTotalsForPlayers(stats.map((stat) => stat.playerId));
    await recalculateOverallForAllPlayers();
    return res.redirect(`/admin/matches/${matchId}?applyVotes=true`);
  } catch (err) {
    console.error("Erro ao aplicar votos em notas:", err);
    return res.redirect(`/admin/matches/${matchId}?error=applyVotes`);
  }
});

// ==============================
// Sort teams
// ==============================

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
    const requestedPlayersPerTeam = Number(req.body.playersPerTeam);
    const playersPerTeam = [5, 6, 7, 8].includes(requestedPlayersPerTeam) ? requestedPlayersPerTeam : 6;

    const guestsRaw = req.body.guests || "";
    const guestEntriesRaw = guestsRaw
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
    const guestEntries = Array.from(
      guestEntriesRaw.reduce((acc, g) => {
        const normalizedName = (g.name || "Convidado").trim().replace(/^\(convidado\)\s*/i, "");
        const key = normalizedName.toLowerCase();
        acc.set(key, {
          ...g,
          name: normalizedName,
        });
        return acc;
      }, new Map()).values()
    );

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

    const playerIds = Array.from(new Set(stats.map((s) => s.playerId)));
    const { scoreMap: overallMap } = await getDynamicOverallSnapshot();

    const recentStatsRaw = await prisma.playerStat.findMany({
      where: { playerId: { in: playerIds } },
      orderBy: { match: { playedAt: "desc" } },
      include: { match: true },
    });

    const recentByPlayer = new Map();
    for (const s of recentStatsRaw) {
      if (!s.match || !s.match.playedAt) continue;
      if (!recentByPlayer.has(s.playerId)) recentByPlayer.set(s.playerId, []);
      if (recentByPlayer.get(s.playerId).length < 10) {
        recentByPlayer.get(s.playerId).push(s);
      }
    }

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
        if (!s.present) return;

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
      const ratingNorm = ratingAvg || 0;

      const last10Score = (ratingNorm * 5 + goalsNorm * 3 + assistsNorm * 2) / 10;

      last10ScoreMap.set(playerId, last10Score);
      rating10Map.set(playerId, ratingAvg);
    });

    const players = stats.map((s) => ({
      id: s.player.id,
      name: s.player.name,
      nickname: s.player.nickname,
      position: s.player.position || "Outros",
      strength: (() => {
        const baseOverall = s.player.overallDynamic ?? overallMap.get(s.playerId) ?? 60;
        const last10Score = last10ScoreMap.get(s.playerId) ?? 0;
        const combined = Math.round(baseOverall * 0.6 + (last10Score * 10) * 0.4);
        return combined;
      })(),
      displayOverall: s.player.overallDynamic ?? overallMap.get(s.playerId) ?? null,
      guest: false,
    }));

    const fullPool = [...players, ...guestEntries];
    const uniquePool = Array.from(
      fullPool.reduce((acc, p) => {
        if (p.guest) {
          const key = `guest:${String(p.name || "Convidado").trim().toLowerCase()}`;
          acc.set(key, p);
          return acc;
        }
        const key = `player:${String(p.id)}`;
        acc.set(key, p);
        return acc;
      }, new Map()).values()
    );

    const goalkeepers = [];
    const fieldPlayers = [];
    uniquePool.forEach((p) => {
      const pos = (p.position || "").toLowerCase();
      const isGoalkeeper = pos.includes("goleiro") || pos.includes("gol");
      if (isGoalkeeper) {
        goalkeepers.push(p);
      } else {
        fieldPlayers.push(p);
      }
    });

    const MIN_PLAYERS_PER_TEAM = playersPerTeam;
    const totalPlayers = fieldPlayers.length;
    const minPlayersForTwoTeams = MIN_PLAYERS_PER_TEAM * 2;
    if (totalPlayers < minPlayersForTwoTeams) {
      return res.status(400).json({
        error: `Sao necessarios pelo menos ${minPlayersForTwoTeams} jogadores de linha para formar 2 times com ${playersPerTeam} por time. Atualmente: ${totalPlayers}.`,
      });
    }

    const teamCount = Math.min(4, Math.floor(totalPlayers / MIN_PLAYERS_PER_TEAM));
    const totalPlayersForTeams = teamCount * playersPerTeam;

    const keepGoalkeepersOnBench = true;
    const teamPool = [...fieldPlayers];

    teamPool.sort((a, b) => b.strength - a.strength);

    const lastDraw = await prisma.lineupDraw.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
    });
    const lastSignature = lastDraw?.result?.teams ? lineupSignature(lastDraw.result.teams) : null;

    const buildLineup = () => {
      const seedSet = new Set(seedIds.map((id) => String(id)));
      const seedPool = [];
      const nonSeedPool = [];
      teamPool.forEach((p) => {
        if (seedSet.has(String(p.id))) seedPool.push(p);
        else nonSeedPool.push(p);
      });
      const orderedFieldPool = [...seedPool, ...nonSeedPool];

      const playersToDistribute = orderedFieldPool.slice(0, totalPlayersForTeams);
      let seedsForTeams = playersToDistribute
        .filter((p) => seedSet.has(String(p.id)))
        .slice(0, teamCount);
      seedsForTeams = shuffleInPlace([...seedsForTeams]);

      const usedSeedIds = new Set(seedsForTeams.map((p) => String(p.id)));
      let remainingPlayers = playersToDistribute.filter((p) => !usedSeedIds.has(String(p.id)));
      remainingPlayers = bucketShuffle(remainingPlayers, teamCount);

      const seededBuckets = Array.from({ length: teamCount }, () => []);
      seedsForTeams.forEach((p, idx) => {
        seededBuckets[idx % teamCount].push(p);
      });

      const autoBuckets = snakeDistribute(remainingPlayers, teamCount);
      const teamBuckets = seededBuckets.map((bucket, idx) => [...bucket, ...(autoBuckets[idx] || [])]);

      const leftoverFieldPlayers = orderedFieldPool.slice(totalPlayersForTeams);
      const bench = [
        ...(keepGoalkeepersOnBench ? goalkeepers : []),
        ...leftoverFieldPlayers,
      ].map((p) => ({
        ...p,
        displayOverall: p.displayOverall ?? overallMap.get(p.id) ?? null,
      }));
      bench.sort((a, b) => b.strength - a.strength);

      const teams = teamBuckets.map((t, idx) => ({
        name: `Time ${idx + 1}`,
        power: computeTeamPower(t),
        players: t.map((p) => ({
          ...p,
          displayOverall: p.displayOverall ?? overallMap.get(p.id) ?? null,
        })),
      }));

      return { teams, bench };
    };

    let lineup = null;
    const MAX_ATTEMPTS = 6;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const candidate = buildLineup();
      if (!lastSignature) {
        lineup = candidate;
        break;
      }
      const signature = lineupSignature(candidate.teams);
      if (signature !== lastSignature) {
        lineup = candidate;
        break;
      }
    }
    if (!lineup) {
      lineup = buildLineup();
    }

    try {
      await prisma.lineupDraw.create({
        data: {
          matchId,
          seed: crypto.randomBytes(8).toString("hex"),
          parameters: {
            presentIds: playerIds,
            guests: guestEntries,
            seeds: seedIds,
            playersPerTeam,
          },
          result: { teams: lineup.teams, bench: lineup.bench },
        },
      });
    } catch (persistErr) {
      console.error("Erro ao salvar sorteio (LineupDraw):", persistErr);
    }

    return res.json({ teams: lineup.teams, bench: lineup.bench });

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
// Voting link and results
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
// Awards card and export
// ==============================

router.get("/matches/:id/awards-card", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.redirect("/admin");

    const voteSession = await prisma.voteSession.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
    });
    const voteSessionClosed = !!(
      !voteSession ||
      (voteSession.expiresAt && new Date(voteSession.expiresAt).getTime() <= Date.now())
    );

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
      voteSession,
      voteSessionClosed,
      canDownloadAwardsImage: voteSessionClosed,
    });
  } catch (err) {
    console.error("Erro ao exibir card de prêmios:", err);
    return res.redirect("/admin");
  }
});

router.get("/matches/:id/awards", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const match = await prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return res.redirect("/admin");

    const voteSession = await prisma.voteSession.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
    });
    const voteSessionClosed = !voteSession || !!(voteSession.expiresAt && voteSession.expiresAt <= new Date());
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
      voteSession,
      voteSessionClosed,
      canDownloadAwardsImage: voteSessionClosed,
    });
  } catch (err) {
    console.error("Erro ao exibir resultados/prêmios:", err);
    return res.redirect("/admin");
  }
});

router.get("/matches/:id/awards/export", requireAdmin, async (req, res) => {
  try {
    const matchId = Number(req.params.id);
    if (Number.isNaN(matchId)) return res.redirect("/admin");

    const voteSession = await prisma.voteSession.findFirst({
      where: { matchId },
      orderBy: { createdAt: "desc" },
    });
    const voteSessionOpen = !!(voteSession && (!voteSession.expiresAt || voteSession.expiresAt > new Date()));
    if (voteSessionOpen) {
      return res.redirect(`/admin/matches/${matchId}/awards#awards-download-flow`);
    }

    const match = await prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true, description: true, playedAt: true },
    });
    if (!match) return res.redirect("/admin");

    const pngBuffer = await captureAwardsCardPng(matchId, req.cookies?.adminToken);
    const dateLabel = new Date(match.playedAt)
      .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      .replace(/\//g, "-");
    const descLabel = String(match.description || "pelada")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resultado-votacao-${descLabel || "pelada"}-${dateLabel}.png"`
    );
    return res.end(pngBuffer);
  } catch (err) {
    console.error("Erro ao exportar imagem dos premios:", err);
    return res.status(500).send("Nao foi possivel gerar a imagem agora.");
  }
});

// ==============================
// Stats wizard
// ==============================

router.post(
  "/matches/:id/stats/wizard",
  requireAdmin,
  uploadWeeklyTeamPhoto.single("teamPhoto"),
  async (req, res) => {
    try {
      const matchId = Number(req.params.id);
      if (Number.isNaN(matchId)) {
        return res.redirect("/admin");
      }

      const result = await saveMatchStatsFromBody(matchId, req.body);
      if (result.error || !result.match) {
        return res.redirect("/admin");
      }

      const skipWeeklyPhoto = req.body.skipWeeklyPhoto === "1";
      if (!skipWeeklyPhoto) {
        const weekStart = getWeekStart(result.match.playedAt);
        const photoUrl = req.file ? `/uploads/weekly/${req.file.filename}` : null;
        const existing = await prisma.weeklyAward.findFirst({ where: { weekStart } });

        if (existing) {
          const updateData = {
            winningMatch: { connect: { id: matchId } },
          };
          if (photoUrl) updateData.teamPhotoUrl = photoUrl;
          await prisma.weeklyAward.update({
            where: { id: existing.id },
            data: updateData,
          });
        } else {
          await prisma.weeklyAward.create({
            data: {
              weekStart,
              teamPhotoUrl: photoUrl,
              winningMatch: { connect: { id: matchId } },
            },
          });
        }
        deleteCache("home");
      }

      return res.redirect(`/admin/matches/${matchId}?statsWizardSaved=true#votacao`);
    } catch (err) {
      console.error("Erro ao salvar estatisticas pelo assistente:", err);
      return res.redirect(`/admin/matches/${req.params.id}?error=statsWizard`);
    }
  }
);

module.exports = router;
