const prisma = require("./db");

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

module.exports = { computeTournamentStandings };
