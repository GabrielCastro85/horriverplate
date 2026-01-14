-- Create enums for tournament game stages and decision type
CREATE TYPE "TournamentStage" AS ENUM ('GROUP', 'SEMI', 'FINAL');
CREATE TYPE "TournamentGameDecidedBy" AS ENUM ('ADVANTAGE', 'PENALTIES');

-- Rename TournamentMatch table to TournamentGame
ALTER TABLE "TournamentMatch" RENAME TO "TournamentGame";

-- Rename foreign key constraints to match new table name
ALTER TABLE "TournamentGame" RENAME CONSTRAINT "TournamentMatch_tournamentId_fkey" TO "TournamentGame_tournamentId_fkey";
ALTER TABLE "TournamentGame" RENAME CONSTRAINT "TournamentMatch_homeTeamId_fkey" TO "TournamentGame_homeTeamId_fkey";
ALTER TABLE "TournamentGame" RENAME CONSTRAINT "TournamentMatch_awayTeamId_fkey" TO "TournamentGame_awayTeamId_fkey";
ALTER TABLE "TournamentGame" RENAME CONSTRAINT "TournamentMatch_winnerTeamId_fkey" TO "TournamentGame_winnerTeamId_fkey";

-- Update column types to enums
ALTER TABLE "TournamentGame" ALTER COLUMN "stage" TYPE "TournamentStage" USING ("stage"::"TournamentStage");
ALTER TABLE "TournamentGame" ALTER COLUMN "decidedBy" TYPE "TournamentGameDecidedBy" USING ("decidedBy"::"TournamentGameDecidedBy");

-- Add penalty fields
ALTER TABLE "TournamentGame" ADD COLUMN "homePenalties" INTEGER;
ALTER TABLE "TournamentGame" ADD COLUMN "awayPenalties" INTEGER;
