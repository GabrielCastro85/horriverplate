-- CreateEnum
CREATE TYPE "SeasonAwardCategory" AS ENUM ('BEST_PLAYER', 'TOP_SCORER', 'BEST_GOALKEEPER', 'BEST_DEFENDER', 'BEST_MIDFIELDER', 'BEST_FORWARD');

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

-- AddForeignKey
ALTER TABLE "SeasonAward" ADD CONSTRAINT "SeasonAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
