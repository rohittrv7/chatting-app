-- ============================================================================
-- Migration: 20260802000000_scalability_fixes
--
-- Changes applied (safe to run in any order within this transaction):
--
-- Fix 1: Report model redesigned for E2EE compatibility
--   - messageContent renamed to decryptedContent (client-side evidence bundle)
--   - Added: encryptedCiphertext TEXT (nullable — ciphertext for verification)
--   - Added: reporterConsentAt TIMESTAMP (non-nullable — explicit consent record)
--
-- Fix 2: Message.deletedForUserIds array → MessageDeletion join table
--   - Create MessageDeletion table with composite unique + individual indexes
--   - Data migration: backfill MessageDeletion from existing array column
--   - Drop Message.deletedForUserIds column after backfill
--
-- Fix 3: RefreshToken.expiresAt index
--   - Add index for the daily cron cleanup query
--
-- Fix 4: BlockedUser reverse-lookup index
--   - Add @@index([blockedId])
--
-- Fix 5: User soft-delete fields
--   - Add isActive BOOLEAN DEFAULT true
--   - Add deletedAt TIMESTAMP (nullable)
--   - Add supporting indexes
--
-- !! BEFORE RUNNING IN PRODUCTION !!
--   1. Take a full DB backup
--   2. Run on staging first and verify row counts match
--   3. The backfill step (Step 2c) may be slow on large Message tables —
--      consider running it in batches off-hours:
--        INSERT INTO "MessageDeletion" (id, "messageId", "userId", "deletedAt")
--        SELECT gen_random_uuid(), id, unnest("deletedForUserIds"), NOW()
--        FROM "Message" WHERE array_length("deletedForUserIds", 1) > 0
--        LIMIT 10000  -- repeat until no rows affected
--   4. Drop the old column only after confirming the backfill is complete
-- ============================================================================

BEGIN;

-- ── Step 1: Fix 5 — User soft-delete fields ───────────────────────────────

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "isActive"   BOOLEAN   NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "deletedAt"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_isActive_idx"  ON "User"("isActive");
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- ── Step 2: Fix 2 — MessageDeletion table ────────────────────────────────

-- 2a. Create the new table
CREATE TABLE IF NOT EXISTS "MessageDeletion" (
    "id"         TEXT         NOT NULL,
    "messageId"  TEXT         NOT NULL,
    "userId"     TEXT         NOT NULL,
    "deletedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDeletion_pkey" PRIMARY KEY ("id")
);

-- 2b. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "MessageDeletion_messageId_userId_key"
  ON "MessageDeletion"("messageId", "userId");

CREATE INDEX IF NOT EXISTS "MessageDeletion_userId_idx"
  ON "MessageDeletion"("userId");

CREATE INDEX IF NOT EXISTS "MessageDeletion_messageId_idx"
  ON "MessageDeletion"("messageId");

-- 2c. Foreign keys
ALTER TABLE "MessageDeletion"
  ADD CONSTRAINT "MessageDeletion_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MessageDeletion"
  ADD CONSTRAINT "MessageDeletion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2d. Backfill: convert existing array entries → join table rows
--     gen_random_uuid() requires the pgcrypto extension (available on all
--     standard Postgres / Supabase / Railway / Render setups).
--     ON CONFLICT DO NOTHING = idempotent (safe to re-run).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Message' AND column_name = 'deletedForUserIds'
  ) THEN
    INSERT INTO "MessageDeletion" ("id", "messageId", "userId", "deletedAt")
    SELECT
      gen_random_uuid()::text,
      m."id",
      unnest(m."deletedForUserIds"),
      NOW()
    FROM "Message" m
    WHERE array_length(m."deletedForUserIds", 1) > 0
    ON CONFLICT ("messageId", "userId") DO NOTHING;
  END IF;
END $$;

-- 2e. Drop the old array column
--     !! Only after verifying the backfill row count matches the source !!
--     Verification query (run before dropping):
--       SELECT COUNT(*) FROM "MessageDeletion";
--       SELECT SUM(array_length("deletedForUserIds",1)) FROM "Message"
--         WHERE array_length("deletedForUserIds",1) > 0;
--     Both numbers must match. Then run:
ALTER TABLE "Message" DROP COLUMN IF EXISTS "deletedForUserIds";

-- ── Step 3: Fix 3 — RefreshToken expiresAt index ─────────────────────────

CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_idx"
  ON "RefreshToken"("expiresAt");

-- ── Step 4: Fix 4 — BlockedUser reverse-lookup index ─────────────────────

CREATE INDEX IF NOT EXISTS "BlockedUser_blockedId_idx"
  ON "BlockedUser"("blockedId");

-- ── Step 5: Fix 1 — Report model E2EE redesign ───────────────────────────

-- 5a. Add new columns (nullable first so existing rows don't violate constraints)
ALTER TABLE "Report"
  ADD COLUMN IF NOT EXISTS "decryptedContent"    TEXT,
  ADD COLUMN IF NOT EXISTS "encryptedCiphertext" TEXT,
  ADD COLUMN IF NOT EXISTS "reporterConsentAt"   TIMESTAMP(3);

-- 5b. Backfill: copy old messageContent into decryptedContent for existing rows,
--     set reporterConsentAt to createdAt (best available approximation)
UPDATE "Report"
SET
  "decryptedContent"  = COALESCE("messageContent", ''),
  "reporterConsentAt" = COALESCE("reporterConsentAt", "createdAt")
WHERE "decryptedContent" IS NULL;

-- 5c. Now that all rows have values, enforce NOT NULL
ALTER TABLE "Report"
  ALTER COLUMN "decryptedContent"  SET NOT NULL,
  ALTER COLUMN "reporterConsentAt" SET NOT NULL;

-- 5d. Drop the old plaintext column
ALTER TABLE "Report" DROP COLUMN IF EXISTS "messageContent";

-- ── Step 6: Add User.username + User.about columns if missing from old init ──
--     (These were added in earlier app code but may be missing from very old DBs)

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "username" TEXT,
  ADD COLUMN IF NOT EXISTS "about"    TEXT DEFAULT 'Hey there! I am using WhatsApp.';

CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");

-- ── Step 7: Add missing columns/indexes from intermediate migrations ──────

-- ConversationMember.clearedHistoryAt (added between migrations)
ALTER TABLE "ConversationMember"
  ADD COLUMN IF NOT EXISTS "clearedHistoryAt" TIMESTAMP(3);

-- Message soft-delete fields
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT,
  ADD COLUMN IF NOT EXISTS "isEdited"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "Message_senderId_clientMessageId_key"
  ON "Message"("senderId", "clientMessageId");

CREATE INDEX IF NOT EXISTS "Message_deletedAt_idx" ON "Message"("deletedAt");

-- Attachment extended fields
ALTER TABLE "Attachment"
  ADD COLUMN IF NOT EXISTS "contentEncoding" TEXT DEFAULT 'identity',
  ADD COLUMN IF NOT EXISTS "originalSize"    INTEGER,
  ADD COLUMN IF NOT EXISTS "compressedSize"  INTEGER,
  ADD COLUMN IF NOT EXISTS "width"           INTEGER,
  ADD COLUMN IF NOT EXISTS "height"          INTEGER,
  ADD COLUMN IF NOT EXISTS "durationSeconds" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "deletedAt"       TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

-- Conversation.deletedAt
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- Report extra indexes
CREATE INDEX IF NOT EXISTS "Report_reporterId_idx"      ON "Report"("reporterId");
CREATE INDEX IF NOT EXISTS "Report_reportedUserId_idx"  ON "Report"("reportedUserId");
CREATE INDEX IF NOT EXISTS "Report_status_idx"          ON "Report"("status");

-- Device.fcmToken
ALTER TABLE "Device"
  ADD COLUMN IF NOT EXISTS "fcmToken" TEXT;

COMMIT;
