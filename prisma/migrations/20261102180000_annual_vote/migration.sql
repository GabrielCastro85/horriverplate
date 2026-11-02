-- CreateTable
CREATE TABLE "AnnualVoteSession" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "candidates" JSONB NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByAdminId" INTEGER,

    CONSTRAINT "AnnualVoteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualVoteToken" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "playerId" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnualVoteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualVotePick" (
    "id" SERIAL NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnualVotePick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnualVoteSession_year_key" ON "AnnualVoteSession"("year");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualVoteToken_token_key" ON "AnnualVoteToken"("token");

-- CreateIndex
CREATE INDEX "AnnualVoteToken_playerId_idx" ON "AnnualVoteToken"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualVoteToken_sessionId_playerId_key" ON "AnnualVoteToken"("sessionId", "playerId");

-- CreateIndex
CREATE INDEX "AnnualVotePick_playerId_idx" ON "AnnualVotePick"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualVotePick_tokenId_category_key" ON "AnnualVotePick"("tokenId", "category");

-- AddForeignKey
ALTER TABLE "AnnualVoteSession" ADD CONSTRAINT "AnnualVoteSession_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualVoteToken" ADD CONSTRAINT "AnnualVoteToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AnnualVoteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualVoteToken" ADD CONSTRAINT "AnnualVoteToken_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualVotePick" ADD CONSTRAINT "AnnualVotePick_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "AnnualVoteToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualVotePick" ADD CONSTRAINT "AnnualVotePick_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
