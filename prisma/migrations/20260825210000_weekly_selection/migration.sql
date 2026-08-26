CREATE TABLE "MatchGuest" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "guestKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nickname" TEXT,
    "position" TEXT NOT NULL,
    "photoUrl" TEXT,
    "strength" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchGuest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WeeklySelectionEntry" (
    "id" SERIAL NOT NULL,
    "matchId" INTEGER NOT NULL,
    "positionGroup" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "playerId" INTEGER,
    "matchGuestId" INTEGER,
    "finalRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "votesCount" INTEGER NOT NULL DEFAULT 0,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklySelectionEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VoteGuestRating" (
    "id" SERIAL NOT NULL,
    "voteBallotId" INTEGER NOT NULL,
    "matchGuestId" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoteGuestRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchGuest_matchId_guestKey_key" ON "MatchGuest"("matchId", "guestKey");
CREATE INDEX "MatchGuest_matchId_idx" ON "MatchGuest"("matchId");

CREATE UNIQUE INDEX "WeeklySelectionEntry_matchId_positionGroup_slot_key" ON "WeeklySelectionEntry"("matchId", "positionGroup", "slot");
CREATE INDEX "WeeklySelectionEntry_playerId_idx" ON "WeeklySelectionEntry"("playerId");
CREATE INDEX "WeeklySelectionEntry_matchGuestId_idx" ON "WeeklySelectionEntry"("matchGuestId");

CREATE UNIQUE INDEX "VoteGuestRating_voteBallotId_matchGuestId_key" ON "VoteGuestRating"("voteBallotId", "matchGuestId");
CREATE INDEX "VoteGuestRating_matchGuestId_idx" ON "VoteGuestRating"("matchGuestId");

ALTER TABLE "MatchGuest" ADD CONSTRAINT "MatchGuest_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklySelectionEntry" ADD CONSTRAINT "WeeklySelectionEntry_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WeeklySelectionEntry" ADD CONSTRAINT "WeeklySelectionEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WeeklySelectionEntry" ADD CONSTRAINT "WeeklySelectionEntry_matchGuestId_fkey" FOREIGN KEY ("matchGuestId") REFERENCES "MatchGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VoteGuestRating" ADD CONSTRAINT "VoteGuestRating_voteBallotId_fkey" FOREIGN KEY ("voteBallotId") REFERENCES "VoteBallot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoteGuestRating" ADD CONSTRAINT "VoteGuestRating_matchGuestId_fkey" FOREIGN KEY ("matchGuestId") REFERENCES "MatchGuest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
