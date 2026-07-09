-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "cpuModel" TEXT,
ADD COLUMN     "hostname" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "macAddresses" TEXT,
ADD COLUMN     "osVersion" TEXT,
ADD COLUMN     "ramGb" INTEGER,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Ibt" ADD COLUMN     "boxNumbers" TEXT;

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryReport" (
    "id" TEXT NOT NULL,
    "assetId" TEXT,
    "hostname" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNo" TEXT,
    "osVersion" TEXT,
    "cpuModel" TEXT,
    "ramGb" INTEGER,
    "macAddresses" TEXT,
    "payload" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceIp" TEXT,

    CONSTRAINT "DiscoveryReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
