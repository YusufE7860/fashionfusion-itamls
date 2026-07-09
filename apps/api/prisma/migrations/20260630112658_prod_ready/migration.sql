-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN     "method" TEXT,
ADD COLUMN     "path" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT;

-- CreateTable
CREATE TABLE "SoftwareTitle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERPETUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwareTitle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareLicense" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "licenseKeyMask" TEXT,
    "licenseKey" TEXT,
    "seatsTotal" INTEGER NOT NULL DEFAULT 1,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "purchaseDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "supplierId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwareLicense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareAssignment" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "userId" TEXT,
    "assetId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "SoftwareAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decommission" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "dataWipeCertUrl" TEXT,
    "disposalSlipUrl" TEXT,
    "disposalVendor" TEXT,
    "disposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedOffById" TEXT,

    CONSTRAINT "Decommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareTitle_name_vendor_key" ON "SoftwareTitle"("name", "vendor");

-- CreateIndex
CREATE UNIQUE INDEX "Decommission_assetId_key" ON "Decommission"("assetId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- AddForeignKey
ALTER TABLE "SoftwareLicense" ADD CONSTRAINT "SoftwareLicense_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "SoftwareTitle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareLicense" ADD CONSTRAINT "SoftwareLicense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareAssignment" ADD CONSTRAINT "SoftwareAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "SoftwareLicense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
