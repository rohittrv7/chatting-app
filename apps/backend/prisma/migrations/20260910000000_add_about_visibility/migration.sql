-- ============================================================================
-- Migration: 20260910000000_add_about_visibility
--
-- Purpose: Adds aboutVisibility column to Setting table to control user bio
-- visibility (EVERYONE, CONTACTS, NOBODY), matching WhatsApp privacy controls.
-- ============================================================================

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN IF NOT EXISTS "aboutVisibility" TEXT NOT NULL DEFAULT 'EVERYONE';

