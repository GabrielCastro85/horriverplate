-- Adiciona campos para overall dinâmico com base inicial
ALTER TABLE "Player"
  ADD COLUMN "baseOverall" DOUBLE PRECISION NOT NULL DEFAULT 60,
  ADD COLUMN "overallDynamic" DOUBLE PRECISION,
  ADD COLUMN "overallLastUpdated" TIMESTAMP;
