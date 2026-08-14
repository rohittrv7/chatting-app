-- AlterTable: Add soft-delete support to Conversation
ALTER TABLE "Conversation" ADD COLUMN "deletedAt" TIMESTAMP(3);
