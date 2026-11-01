-- CreateEnum
CREATE TYPE "PlaylistClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClaimVerificationMethod" AS ENUM ('EMAIL', 'WEBSITE', 'SPOTIFY', 'MANUAL');

-- AlterTable
ALTER TABLE "Curator" ADD COLUMN     "clerkUserId" TEXT;

-- CreateTable
CREATE TABLE "PlaylistClaim" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "curatorId" TEXT NOT NULL,
    "status" "PlaylistClaimStatus" NOT NULL DEFAULT 'PENDING',
    "verificationMethod" "ClaimVerificationMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),

    CONSTRAINT "PlaylistClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistClaim_playlistId_key" ON "PlaylistClaim"("playlistId");

-- CreateIndex
CREATE INDEX "PlaylistClaim_curatorId_idx" ON "PlaylistClaim"("curatorId");

-- CreateIndex
CREATE INDEX "PlaylistClaim_status_idx" ON "PlaylistClaim"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Curator_clerkUserId_key" ON "Curator"("clerkUserId");

-- AddForeignKey
ALTER TABLE "PlaylistClaim" ADD CONSTRAINT "PlaylistClaim_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistClaim" ADD CONSTRAINT "PlaylistClaim_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "Curator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
