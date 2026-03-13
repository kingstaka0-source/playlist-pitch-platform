-- AlterTable
ALTER TABLE "Curator" ADD COLUMN     "contactConfidence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contactSourceUrl" TEXT,
ADD COLUMN     "enrichmentNotes" TEXT,
ADD COLUMN     "instagramUrl" TEXT,
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3),
ADD COLUMN     "submissionUrl" TEXT,
ADD COLUMN     "websiteUrl" TEXT;
