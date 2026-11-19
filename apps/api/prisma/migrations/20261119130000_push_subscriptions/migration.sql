-- Web Push subscriptions per user per device.
CREATE TABLE IF NOT EXISTS "PushSubscription" (
    "id"         TEXT PRIMARY KEY,
    "userId"     TEXT NOT NULL,
    "endpoint"   TEXT NOT NULL UNIQUE,
    "p256dh"     TEXT NOT NULL,
    "auth"       TEXT NOT NULL,
    "userAgent"  TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");
