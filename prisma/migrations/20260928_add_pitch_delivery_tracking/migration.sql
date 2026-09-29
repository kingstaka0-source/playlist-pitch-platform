-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'DELIVERY_DELAYED', 'BOUNCED', 'COMPLAINED', 'FAILED', 'SUPPRESSED');

-- AlterTable
ALTER TABLE "Pitch" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryStatus" "DeliveryStatus",
ADD COLUMN     "providerMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Pitch_providerMessageId_key" ON "Pitch"("providerMessageId");
