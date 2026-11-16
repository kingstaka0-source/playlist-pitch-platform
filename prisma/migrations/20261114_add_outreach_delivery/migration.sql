-- CreateTable
CREATE TABLE "OutreachDelivery" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "curatorId" TEXT,
    "playlistId" TEXT,
    "pitchId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "source" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachIdentity" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "identityType" TEXT NOT NULL,
    "identityValue" TEXT NOT NULL,
    "deliveryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDelivery_pitchId_key" ON "OutreachDelivery"("pitchId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachDelivery_providerMessageId_key" ON "OutreachDelivery"("providerMessageId");

-- CreateIndex
CREATE INDEX "OutreachDelivery_artistId_trackId_idx" ON "OutreachDelivery"("artistId", "trackId");

-- CreateIndex
CREATE INDEX "OutreachDelivery_pitchId_idx" ON "OutreachDelivery"("pitchId");

-- CreateIndex
CREATE INDEX "OutreachDelivery_status_idx" ON "OutreachDelivery"("status");

-- CreateIndex
CREATE INDEX "OutreachIdentity_deliveryId_idx" ON "OutreachIdentity"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachIdentity_trackId_identityType_identityValue_key" ON "OutreachIdentity"("trackId", "identityType", "identityValue");
