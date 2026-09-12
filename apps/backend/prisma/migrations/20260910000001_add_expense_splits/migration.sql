-- ============================================================================
-- Migration: 20260910000001_add_expense_splits
--
-- Purpose: Adds isSplitGroup and splitExpenseId to Conversation, and creates
-- ExpenseSplit and ExpenseParticipant tables for Bill Split / Expense Tracker.
-- ============================================================================

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "isSplitGroup" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "splitExpenseId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExpenseSplit" (
    "id" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "conversationId" TEXT,
    "splitGroupId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),
    "autoDeleteAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ExpenseParticipant" (
    "id" TEXT NOT NULL,
    "expenseSplitId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountOwed" DECIMAL(65,30) NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "ExpenseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseSplit_splitGroupId_key" ON "ExpenseSplit"("splitGroupId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseSplit_createdBy_idx" ON "ExpenseSplit"("createdBy");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseSplit_status_idx" ON "ExpenseSplit"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseSplit_autoDeleteAt_idx" ON "ExpenseSplit"("autoDeleteAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ExpenseParticipant_userId_idx" ON "ExpenseParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ExpenseParticipant_expenseSplitId_userId_key" ON "ExpenseParticipant"("expenseSplitId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_splitExpenseId_key" ON "Conversation"("splitExpenseId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseSplit_createdBy_fkey') THEN
        ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseSplit_conversationId_fkey') THEN
        ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseSplit_splitGroupId_fkey') THEN
        ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_splitGroupId_fkey" FOREIGN KEY ("splitGroupId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseParticipant_expenseSplitId_fkey') THEN
        ALTER TABLE "ExpenseParticipant" ADD CONSTRAINT "ExpenseParticipant_expenseSplitId_fkey" FOREIGN KEY ("expenseSplitId") REFERENCES "ExpenseSplit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExpenseParticipant_userId_fkey') THEN
        ALTER TABLE "ExpenseParticipant" ADD CONSTRAINT "ExpenseParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
