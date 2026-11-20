-- Link each Repair back to the Ticket it came from. Stores no longer log
-- repairs directly - the tech triages the call and converts it to a repair.
ALTER TABLE "Repair" ADD COLUMN IF NOT EXISTS "ticketId" TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Repair_ticketId_fkey') THEN
        ALTER TABLE "Repair"
            ADD CONSTRAINT "Repair_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Repair_ticketId_idx" ON "Repair"("ticketId");
