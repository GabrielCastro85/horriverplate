-- Atualiza enum SeasonAwardCategory para usar as novas chaves e incluir "Rei das fotos"
CREATE TYPE "SeasonAwardCategory_new" AS ENUM (
  'ARTILHEIRO',
  'ASSISTENTE',
  'MELHOR_JOGADOR',
  'MELHOR_GOLEIRO',
  'MELHOR_ZAGUEIRO',
  'MELHOR_MEIA',
  'MELHOR_ATACANTE',
  'REI_DAS_FOTOS'
);

ALTER TABLE "SeasonAward"
  ALTER COLUMN "category" TYPE "SeasonAwardCategory_new"
  USING ("category"::text::"SeasonAwardCategory_new");

DROP TYPE "SeasonAwardCategory";
ALTER TYPE "SeasonAwardCategory_new" RENAME TO "SeasonAwardCategory";
