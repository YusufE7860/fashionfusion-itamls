-- Store Portal: extend Repair with fields the store users need (what's wrong,
-- which technician, waybill, dispatched / returned dates, resolution notes),
-- plus scope fields (storeId, reportedById) and optional asset linkage.

-- 1. Allow NULL on assetId (store users may not know the asset ID).
ALTER TABLE "Repair" ALTER COLUMN "assetId" DROP NOT NULL;

-- 2. Add scope + extra tracking fields.
ALTER TABLE "Repair"
    ADD COLUMN IF NOT EXISTS "storeId"         TEXT,
    ADD COLUMN IF NOT EXISTS "reportedById"    TEXT,
    ADD COLUMN IF NOT EXISTS "itemDescription" TEXT,
    ADD COLUMN IF NOT EXISTS "technicianName"  TEXT,
    ADD COLUMN IF NOT EXISTS "waybillNumber"   TEXT,
    ADD COLUMN IF NOT EXISTS "dispatchedDate"  TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "returnedDate"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "resolutionNotes" TEXT,
    ADD COLUMN IF NOT EXISTS "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Foreign keys.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Repair_storeId_fkey') THEN
        ALTER TABLE "Repair"
            ADD CONSTRAINT "Repair_storeId_fkey"
            FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Repair_reportedById_fkey') THEN
        ALTER TABLE "Repair"
            ADD CONSTRAINT "Repair_reportedById_fkey"
            FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 4. Indexes for the portal queries.
CREATE INDEX IF NOT EXISTS "Repair_storeId_status_idx"  ON "Repair"("storeId", "status");
CREATE INDEX IF NOT EXISTS "Repair_reportedById_idx"    ON "Repair"("reportedById");
