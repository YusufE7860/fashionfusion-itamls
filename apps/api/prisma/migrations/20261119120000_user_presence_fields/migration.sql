-- Add presence + phone to User so the Store Portal can show who's
-- currently reachable per call.

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "phone"          TEXT,
    ADD COLUMN IF NOT EXISTS "lastActiveAt"   TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "presenceStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "presenceSetAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_lastActiveAt_idx" ON "User"("lastActiveAt");
