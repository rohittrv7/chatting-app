-- ============================================================================
-- Rollback: 20260802000000_scalability_fixes
--
-- !! WARNING: This rollback is DESTRUCTIVE !!
--   - MessageDeletion rows will be lost (they cannot be re-converted to arrays
--     cleanly once the deletedForUserIds column is dropped).
--   - decryptedContent data in Report will be lost once messageContent is re-added
--     (the Report rows would need manual data migration back).
--
-- Only run this rollback immediately after the forward migration, before any
-- new MessageDeletion / Report rows are written by the application.
-- After any production traffic, a point-in-time restore is safer.
-- ============================================================================

BEGIN;

-- Reverse Fix 1: Restore Report.messageContent
ALTER TABLE "Report"
  ADD COLUMN IF NOT EXISTS "messageContent" TEXT NOT NULL DEFAULT '';

UPDATE "Report"
SET "messageContent" = COALESCE("decryptedContent", '');

ALTER TABLE "Report"
  DROP COLUMN IF EXISTS "decryptedContent",
  DROP COLUMN IF EXISTS "encryptedCiphertext",
  DROP COLUMN IF EXISTS "reporterConsentAt";

-- Reverse Fix 2: Restore Message.deletedForUserIds
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "deletedForUserIds" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "Message" m
SET "deletedForUserIds" = (
  SELECT COALESCE(array_agg(md."userId"), '{}')
  FROM "MessageDeletion" md
  WHERE md."messageId" = m."id"
);

DROP TABLE IF EXISTS "MessageDeletion";

-- Reverse Fix 3
DROP INDEX IF EXISTS "RefreshToken_expiresAt_idx";

-- Reverse Fix 4
DROP INDEX IF EXISTS "BlockedUser_blockedId_idx";

-- Reverse Fix 5
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "isActive",
  DROP COLUMN IF EXISTS "deletedAt";

DROP INDEX IF EXISTS "User_isActive_idx";
DROP INDEX IF EXISTS "User_deletedAt_idx";

COMMIT;
