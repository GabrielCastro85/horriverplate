-- AlterTable
ALTER TABLE "MonthlyVoteSession" ADD COLUMN "selectionCandidates" JSONB;

-- AlterTable
ALTER TABLE "MonthlyAward" ADD COLUMN "selection" JSONB;

-- CreateTable
CREATE TABLE "MonthlySelectionVote" (
    "id" SERIAL NOT NULL,
    "tokenId" INTEGER NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "playerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlySelectionVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySelectionVote_tokenId_playerId_key" ON "MonthlySelectionVote"("tokenId", "playerId");

-- CreateIndex
CREATE INDEX "MonthlySelectionVote_playerId_idx" ON "MonthlySelectionVote"("playerId");

-- AddForeignKey
ALTER TABLE "MonthlySelectionVote" ADD CONSTRAINT "MonthlySelectionVote_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MonthlyVoteToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlySelectionVote" ADD CONSTRAINT "MonthlySelectionVote_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
