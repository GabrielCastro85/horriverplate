-- CreateEnum
CREATE TYPE "SeasonAwardCategory" AS ENUM ('ARTILHEIRO', 'ASSISTENTE', 'MELHOR_JOGADOR', 'MELHOR_GOLEIRO', 'MELHOR_ZAGUEIRO', 'MELHOR_MEIA', 'MELHOR_ATACANTE', 'REI_DAS_FOTOS');

-- CreateEnum
CREATE TYPE "VoteCategory" AS ENUM ('GOLEIRO', 'ZAGUEIRO', 'MEIA', 'ATACANTE', 'CRAQUE');

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "position" TEXT NOT NULL,
    "photoUrl" TEXT,
    "totalGoals" INTEGER NOT NULL DEFAULT 0,
    "totalAssists" INTEGER NOT NULL DEFAULT 0,
    "totalMatches" INTEGER NOT NULL DEFAULT 0,
    "totalPhotos" INTEGER NOT NULL DEFAULT 0,
    "totalRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "whatsapp" TEXT,
    "hallBadges" JSONB,
    "hallInductedAt" TIMESTAMP(3),
    "hallReason" TEXT,
    "hallTitle" TEXT,
    "isHallOfFame" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" SERIAL NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "winnerTeam" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerStat" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "matchId" INTEGER NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "appearedInPhoto" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyAward" (
    "id" SERIAL NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "teamPhotoUrl" TEXT,
    "bestPlayerId" INTEGER,
    "winningMatchId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyAward" (
    "id" SERIAL NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "craqueId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonAward" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "category" "SeasonAwardCategory" NOT NULL,
    "playerId" INTEGER NOT NULL,
    "featuredOnHome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteSession" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdByAdminId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "voteSessionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteBallot" (
    "id" SERIAL NOT NULL,
    "voteTokenId" INTEGER NOT NULL,
    "bestOverallPlayerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteBallot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteRanking" (
    "id" SERIAL NOT NULL,
    "voteBallotId" INTEGER NOT NULL,
    "position" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteLink" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    "playerId" INTEGER NOT NULL,
    "matchId" INTEGER NOT NULL,
    "phone" TEXT,

    CONSTRAINT "VoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoteChoice" (
    "id" SERIAL NOT NULL,
    "category" "VoteCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voteLinkId" INTEGER NOT NULL,
    "targetPlayerId" INTEGER NOT NULL,

    CONSTRAINT "VoteChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "icon" TEXT,
    "criteria" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerAchievement" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "achievementId" INTEGER NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "PlayerAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OverallHistory" (
    "id" SERIAL NOT NULL,
    "playerId" INTEGER NOT NULL,
    "overall" DOUBLE PRECISION NOT NULL,
    "window" TEXT,
    "source" JSONB,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OverallHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineupDraw" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "parameters" JSONB,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LineupDraw_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerStat_playerId_matchId_key" ON "PlayerStat"("playerId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyAward_weekStart_key" ON "WeeklyAward"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyAward_month_year_key" ON "MonthlyAward"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonAward_year_category_key" ON "SeasonAward"("year", "category");

-- CreateIndex
CREATE UNIQUE INDEX "VoteToken_token_key" ON "VoteToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VoteToken_voteSessionId_playerId_key" ON "VoteToken"("voteSessionId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteBallot_voteTokenId_key" ON "VoteBallot"("voteTokenId");

-- CreateIndex
CREATE UNIQUE INDEX "VoteRanking_voteBallotId_position_rank_key" ON "VoteRanking"("voteBallotId", "position", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "VoteLink_token_key" ON "VoteLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_slug_key" ON "Achievement"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerAchievement_playerId_achievementId_key" ON "PlayerAchievement"("playerId", "achievementId");

-- CreateIndex
CREATE INDEX "OverallHistory_playerId_calculatedAt_idx" ON "OverallHistory"("playerId", "calculatedAt");

-- CreateIndex
CREATE INDEX "LineupDraw_matchId_createdAt_idx" ON "LineupDraw"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStat" ADD CONSTRAINT "PlayerStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAward" ADD CONSTRAINT "WeeklyAward_bestPlayerId_fkey" FOREIGN KEY ("bestPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAward" ADD CONSTRAINT "WeeklyAward_winningMatchId_fkey" FOREIGN KEY ("winningMatchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAward" ADD CONSTRAINT "MonthlyAward_craqueId_fkey" FOREIGN KEY ("craqueId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonAward" ADD CONSTRAINT "SeasonAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteSession" ADD CONSTRAINT "VoteSession_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteSession" ADD CONSTRAINT "VoteSession_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteToken" ADD CONSTRAINT "VoteToken_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteToken" ADD CONSTRAINT "VoteToken_voteSessionId_fkey" FOREIGN KEY ("voteSessionId") REFERENCES "VoteSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_bestOverallPlayerId_fkey" FOREIGN KEY ("bestOverallPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteBallot" ADD CONSTRAINT "VoteBallot_voteTokenId_fkey" FOREIGN KEY ("voteTokenId") REFERENCES "VoteToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRanking" ADD CONSTRAINT "VoteRanking_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteRanking" ADD CONSTRAINT "VoteRanking_voteBallotId_fkey" FOREIGN KEY ("voteBallotId") REFERENCES "VoteBallot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteLink" ADD CONSTRAINT "VoteLink_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteLink" ADD CONSTRAINT "VoteLink_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteChoice" ADD CONSTRAINT "VoteChoice_targetPlayerId_fkey" FOREIGN KEY ("targetPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoteChoice" ADD CONSTRAINT "VoteChoice_voteLinkId_fkey" FOREIGN KEY ("voteLinkId") REFERENCES "VoteLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerAchievement" ADD CONSTRAINT "PlayerAchievement_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverallHistory" ADD CONSTRAINT "OverallHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupDraw" ADD CONSTRAINT "LineupDraw_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

