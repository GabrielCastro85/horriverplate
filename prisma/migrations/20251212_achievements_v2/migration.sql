-- Ajustes de Achievements e PlayerAchievements

-- Achievement: novos campos e migração de dados existentes
ALTER TABLE "Achievement"
ADD COLUMN "code" TEXT,
ADD COLUMN "title" TEXT,
ADD COLUMN "rarity" TEXT DEFAULT 'bronze',
ADD COLUMN "targetValue" INTEGER,
ADD COLUMN "symbol" TEXT,
ADD COLUMN "isNumeric" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- migra slug -> code, name -> title
UPDATE "Achievement" SET "code" = COALESCE("slug", CONCAT('ach_', "id"));
UPDATE "Achievement" SET "title" = COALESCE("name", 'Conquista');
-- garante categoria e raridade não nulos
UPDATE "Achievement" SET "category" = COALESCE("category", 'geral');
UPDATE "Achievement" SET "rarity" = COALESCE("rarity", 'bronze');

-- torna colunas not null
ALTER TABLE "Achievement" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Achievement" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "Achievement" ALTER COLUMN "category" SET NOT NULL;
ALTER TABLE "Achievement" ALTER COLUMN "rarity" DROP DEFAULT;
ALTER TABLE "Achievement" ALTER COLUMN "rarity" SET NOT NULL;

-- remove colunas antigas
ALTER TABLE "Achievement" DROP COLUMN "slug";
ALTER TABLE "Achievement" DROP COLUMN "name";
ALTER TABLE "Achievement" DROP COLUMN "icon";
ALTER TABLE "Achievement" DROP COLUMN "criteria";

-- atualiza índice único
DROP INDEX IF EXISTS "Achievement_slug_key";
CREATE UNIQUE INDEX "Achievement_code_key" ON "Achievement"("code");

-- PlayerAchievement: novos campos e ajustes
ALTER TABLE "PlayerAchievement"
ADD COLUMN "progressValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
ADD COLUMN "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW();

-- unlockedAt deve ser opcional
ALTER TABLE "PlayerAchievement" ALTER COLUMN "unlockedAt" DROP NOT NULL;
ALTER TABLE "PlayerAchievement" ALTER COLUMN "unlockedAt" DROP DEFAULT;

-- remove meta
ALTER TABLE "PlayerAchievement" DROP COLUMN "meta";

-- índices
CREATE INDEX IF NOT EXISTS "PlayerAchievement_playerId_idx" ON "PlayerAchievement"("playerId");
CREATE INDEX IF NOT EXISTS "PlayerAchievement_achievementId_idx" ON "PlayerAchievement"("achievementId");
