-- CreateTable
CREATE TABLE "HelpdeskLink" (
    "id" TEXT NOT NULL,
    "ticketExternalId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpdeskLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HelpdeskLink_assetId_idx" ON "HelpdeskLink"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "HelpdeskLink_system_ticketExternalId_key" ON "HelpdeskLink"("system", "ticketExternalId");
