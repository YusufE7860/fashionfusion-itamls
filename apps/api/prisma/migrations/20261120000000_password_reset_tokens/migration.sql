-- Password reset tokens for "Forgot password" email flow.
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id"           TEXT PRIMARY KEY,
    "userId"       TEXT NOT NULL,
    "tokenHash"    TEXT NOT NULL UNIQUE,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "usedAt"       TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requesterIp"  TEXT,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"    ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
