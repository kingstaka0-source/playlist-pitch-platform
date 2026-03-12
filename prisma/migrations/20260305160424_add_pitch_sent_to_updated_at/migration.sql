-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('INAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "TasteLabel" AS ENUM ('ADDED', 'SKIPPED', 'LIKED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('INAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "PitchStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'TRIAL', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('NONE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "AgreementSubjectType" AS ENUM ('ARTIST', 'CURATOR');

-- CreateEnum
CREATE TYPE "AgreementDocType" AS ENUM ('TERMS', 'PRIVACY', 'PITCH_CONSENT', 'BILLING_TERMS');

-- CreateEnum
CREATE TYPE "MatchJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "spotifyId" TEXT,
    "spotifyAccessToken" TEXT,
    "spotifyRefreshToken" TEXT,
    "spotifyTokenExpiresAt" TIMESTAMP(3),
    "spotifyScopes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "trialUntil" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'NONE',
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "spotifyTrackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artists" TEXT[],
    "durationMs" INTEGER NOT NULL,
    "audioFeatures" JSONB NOT NULL,
    "genres" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Curator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "contactMethod" "ContactMethod" NOT NULL,
    "consent" BOOLEAN NOT NULL DEFAULT true,
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Curator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "curatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spotifyPlaylistId" TEXT,
    "genres" TEXT[],
    "minBpm" INTEGER,
    "maxBpm" INTEGER,
    "minEnergy" DOUBLE PRECISION,
    "maxEnergy" DOUBLE PRECISION,
    "rules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TasteEvent" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "spotifyTrackId" TEXT NOT NULL,
    "label" "TasteLabel" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TasteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "fitScore" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pitch" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "PitchStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "sentTo" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pitch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementAcceptance" (
    "id" TEXT NOT NULL,
    "subjectType" "AgreementSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "docType" "AgreementDocType" NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,

    CONSTRAINT "AgreementAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchJob" (
    "id" TEXT NOT NULL,
    "status" "MatchJobStatus" NOT NULL DEFAULT 'QUEUED',
    "trackId" TEXT NOT NULL,
    "artistId" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artist_email_key" ON "Artist"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_spotifyId_key" ON "Artist"("spotifyId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_stripeCustomerId_key" ON "Artist"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_stripeSubscriptionId_key" ON "Artist"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_spotifyTrackId_key" ON "Track"("spotifyTrackId");

-- CreateIndex
CREATE UNIQUE INDEX "Curator_email_key" ON "Curator"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Match_trackId_playlistId_key" ON "Match"("trackId", "playlistId");

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_matchId_key" ON "Pitch"("matchId");

-- CreateIndex
CREATE INDEX "subject_lookup" ON "AgreementAcceptance"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementAcceptance_subjectType_subjectId_docType_version_key" ON "AgreementAcceptance"("subjectType", "subjectId", "docType", "version");

-- CreateIndex
CREATE INDEX "MatchJob_status_runAt_idx" ON "MatchJob"("status", "runAt");

-- CreateIndex
CREATE INDEX "MatchJob_trackId_idx" ON "MatchJob"("trackId");

-- CreateIndex
CREATE INDEX "MatchJob_lockedAt_idx" ON "MatchJob"("lockedAt");

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "Curator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TasteEvent" ADD CONSTRAINT "TasteEvent_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pitch" ADD CONSTRAINT "Pitch_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
