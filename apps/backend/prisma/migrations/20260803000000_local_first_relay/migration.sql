-- ============================================================================
-- Migration: 20260803000000_local_first_relay
--
-- Purpose: Implements WhatsApp-style "server as temporary relay" architecture.
-- The server stores message content only until all recipients have confirmed
-- delivery (DELIVERED status). After that the ciphertexts are cleared and
-- the device's local WatermelonDB becomes the permanent source of truth.
--
-- Changes:
--   1. Message.ciphertexts  — made NULLABLE (was NOT NULL Json)
--   2. Message.contentClearedAt — new TIMESTAMP column (nullable)
--   3. AttachmentDownload — new table tracking per-user attachment downloads
--      so the media cleanup cron knows when it is safe to delete files
--
-- !! BEFORE RUNNING IN PRODUCTION !!
--   1. Take a full DB backup
--   2. Run on staging first
--   3. Step 1 (ALTER COLUMN to nullable) is safe online — no table rewrite needed
--   4. Step 2 (new nullable column) is safe online
--   5. Step 3 (new table) is safe online
-- ============================================================================

BEGIN;

-- ── Step 1: Make Message.ciphertexts nullable ─────────────────────────────
-- Previously NOT NULL. Safe to make nullable — existing rows keep their values,
-- future cleared messages will have NULL here.
ALTER TABLE "Message"
  ALTER COLUMN "ciphertexts" DROP NOT NULL;

-- ── Step 2: Add Message.contentClearedAt ─────────────────────────────────
-- Audit timestamp: set when the cleanup service nulls out ciphertexts.
ALTER TABLE "Message"
  ADD COLUMN IF NOT EXISTS "contentClearedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Message_contentClearedAt_idx"
  ON "Message"("contentClearedAt");

-- ── Step 3: AttachmentDownload join table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "AttachmentDownload" (
    "id"           TEXT         NOT NULL,
    "attachmentId" TEXT         NOT NULL,
    "userId"       TEXT         NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttachmentDownload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AttachmentDownload_attachmentId_userId_key"
  ON "AttachmentDownload"("attachmentId", "userId");

CREATE INDEX IF NOT EXISTS "AttachmentDownload_attachmentId_idx"
  ON "AttachmentDownload"("attachmentId");

CREATE INDEX IF NOT EXISTS "AttachmentDownload_downloadedAt_idx"
  ON "AttachmentDownload"("downloadedAt");

ALTER TABLE "AttachmentDownload"
  ADD CONSTRAINT "AttachmentDownload_attachmentId_fkey"
    FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AttachmentDownload"
  ADD CONSTRAINT "AttachmentDownload_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
