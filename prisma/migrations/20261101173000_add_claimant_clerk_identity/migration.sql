-- AlterTable
ALTER TABLE "PlaylistClaim" ADD COLUMN     "claimantClerkUserId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PlaylistClaim_claimantClerkUserId_idx" ON "PlaylistClaim"("claimantClerkUserId");

