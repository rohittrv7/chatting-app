-- Rollback: Remove soft-delete column from Conversation
ALTER TABLE "Conversation" DROP COLUMN IF EXISTS "deletedAt";
