// routes/matches.js
const express = require("express");
const router = express.Router();
const prisma = require("../utils/db");
const { computeTournamentStandings } = require("../utils/tournament");
const { computeMatchRatingsAndAwards } = require("../utils/match_ratings");
const { formatDateBR } = require("../utils/finance");

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(404).render("404", { title: "404" });

    const match = await prisma.match.findUnique({
      where: { id },
      include: {
        stats: {
          include: { player: true },
          orderBy: { player: { name: "asc" } },
        },
        voteSessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        tournament: {
          include: {
            teams: { orderBy: { id: "asc" } },
            games: {
              include: { homeTeam: true, awayTeam: true, winnerTeam: true },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    });

    if (!match) return res.status(404).render("404", { title: "404" });

    // Ratings released logic (uses voteSession expiry when available)
    const latestVoteSession =
      Array.isArray(match.voteSessions) && match.voteSessions.length
        ? match.voteSessions[0]
        : null;
    const latestVoteSessionClosed =
      !!latestVoteSession?.expiresAt &&
      new Date(latestVoteSession.expiresAt).getTime() <= Date.now();
    const ratingsReleased = latestVoteSession
      ? latestVoteSessionClosed
      : match.votingStatus === "CLOSED";

    // Only show stats for present players; recalculate final ratings if released
    let publicStats = (match.stats || []).filter((s) => s.present);
    if (ratingsReleased) {
      try {
        const result = await computeMatchRatingsAndAwards(id);
        if (!result.error && result.scores && typeof result.scores.forEach === "function") {
          const finalMap = new Map(result.scores.map((s) => [s.player.id, s.finalRating]));
          publicStats = publicStats.map((stat) => ({
            ...stat,
            rating: finalMap.has(stat.playerId) ? finalMap.get(stat.playerId) : stat.rating,
          }));
        }
      } catch (calcErr) {
        console.warn("Falha ao calcular nota final pública:", calcErr);
      }
    }

    // Tournament data
    const tournament = match.tournament || null;
    const tournamentTeams = tournament ? tournament.teams : [];
    const tournamentStandings = tournament
      ? await computeTournamentStandings(tournament.id)
      : [];

    // OG meta tags
    const weeklyPhoto = await prisma.weeklyAward.findFirst({
      where: { winningMatchId: id, teamPhotoUrl: { not: null } },
      orderBy: { weekStart: "desc" },
      select: { teamPhotoUrl: true },
    });
    const baseUrl = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
    const matchDateLabel = formatDateBR(match.playedAt);
    const shareImagePath = weeklyPhoto?.teamPhotoUrl || "/img/logo.jpg";
    res.locals.metaDescription = match.description
      ? `Pelada em ${matchDateLabel}. ${match.description}`
      : `Pelada em ${matchDateLabel}.`;
    res.locals.metaImage = `${baseUrl}${req.app.locals.thumbUrl(shareImagePath, 1200)}`;
    res.locals.ogTitle = `Pelada ${matchDateLabel} | Horriver Plate`;

    return res.render("match_public", {
      title: "Estatísticas da pelada",
      activePage: "home",
      match,
      stats: publicStats,
      ratingsReleased,
      tournament,
      tournamentTeams,
      tournamentStandings,
    });
  } catch (err) {
    console.error("Erro em GET /matches/:id:", err);
    res.status(500).send("Erro ao carregar estatísticas da pelada");
  }
});

module.exports = router;
