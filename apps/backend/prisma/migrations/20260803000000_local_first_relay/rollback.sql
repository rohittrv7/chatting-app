-- ============================================================================
-- Rollback: 20260803000000_local_first_relay
--
-- WARNING: Rolling back ciphertexts to NOT NULL will fail if any rows
-- have NULL ciphertexts (i.e., if the cleanup service has already run).
-- Only safe to roll back IMMEDIATELY after the forward migration if no
-- cleanup has occurred.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS "AttachmentDownload";
DROP INDEX IF EXISTS "Message_contentClearedAt_idx";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "contentClearedAt";

-- Only restore NOT NULL if no rows have been cleared yet
-- ALTER TABLE "Message" ALTER COLUMN "ciphertexts" SET NOT NULL;

COMMIT;
