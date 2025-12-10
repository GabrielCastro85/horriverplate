-- Add voting support columns to Match
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "votingToken" TEXT;
ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "votingStatus" TEXT DEFAULT 'CLOSED';
