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
CREATE INDEX "OverallHistory_playerId_calculatedAt_idx" ON "OverallHistory"("playerId", "calculatedAt");

-- CreateIndex
CREATE INDEX "LineupDraw_matchId_createdAt_idx" ON "LineupDraw"("matchId", "createdAt");

-- AddForeignKey
ALTER TABLE "OverallHistory" ADD CONSTRAINT "OverallHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineupDraw" ADD CONSTRAINT "LineupDraw_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

