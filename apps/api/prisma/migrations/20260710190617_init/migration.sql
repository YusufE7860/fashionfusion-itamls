-- CreateTable
CREATE TABLE "StorePc" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'TILL',
    "backupPaths" TEXT NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastBackupAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "scheduleCron" TEXT NOT NULL DEFAULT '0 2 * * *',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "pcId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "error" TEXT,
    "sourceIp" TEXT,

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorePc_storeId_idx" ON "StorePc"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StorePc_storeId_name_key" ON "StorePc"("storeId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BackupJob_storeId_key" ON "BackupJob"("storeId");

-- CreateIndex
CREATE INDEX "BackupRun_pcId_startedAt_idx" ON "BackupRun"("pcId", "startedAt");

-- AddForeignKey
ALTER TABLE "StorePc" ADD CONSTRAINT "StorePc_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupJob" ADD CONSTRAINT "BackupJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_pcId_fkey" FOREIGN KEY ("pcId") REFERENCES "StorePc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
