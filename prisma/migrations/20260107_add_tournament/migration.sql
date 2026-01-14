-- Create Tournament tables
CREATE TABLE "Tournament" (
  "id" SERIAL PRIMARY KEY,
  "matchId" INTEGER NOT NULL UNIQUE,
  "title" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tournament_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TournamentTeam" (
  "id" SERIAL PRIMARY KEY,
  "tournamentId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "seed" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentTeam_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TournamentMatch" (
  "id" SERIAL PRIMARY KEY,
  "tournamentId" INTEGER NOT NULL,
  "stage" TEXT NOT NULL,
  "round" INTEGER,
  "homeTeamId" INTEGER NOT NULL,
  "awayTeamId" INTEGER NOT NULL,
  "homeGoals" INTEGER,
  "awayGoals" INTEGER,
  "winnerTeamId" INTEGER,
  "decidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TournamentMatch_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TournamentMatch_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "TournamentTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TournamentMatch_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "TournamentTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
