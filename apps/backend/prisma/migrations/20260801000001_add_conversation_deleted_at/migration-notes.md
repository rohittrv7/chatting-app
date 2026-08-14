# Migration Notes: `20260801000001_add_conversation_deleted_at`

## Change Summary

Adds a nullable `deletedAt` column to the `Conversation` table to support soft-delete semantics. When a conversation is "deleted", the server sets this timestamp rather than issuing a hard `DELETE`. The row remains in the database and can be excluded from queries using a `WHERE "deletedAt" IS NULL` filter.

## Affected Entities

| Entity | Change |
|--------|--------|
| `Conversation` (table) | New column `deletedAt TIMESTAMP(3)` — nullable, no default |
| Prisma schema `Conversation` model | New field `deletedAt DateTime?` |

No other tables, indexes, or foreign key constraints are added or removed by this migration.

## Why Soft-Delete?

Requirements 4.8, 25.1, 25.2, and 25.3 specify that conversation deletion must be reversible and auditable:

- **4.8** — Conversations that are deleted by a user should not be permanently destroyed; the data must remain recoverable for audit/compliance purposes.
- **25.1** — The system shall support soft-deletion of conversations via a `deletedAt` timestamp.
- **25.2** — Soft-deleted conversations shall be excluded from normal list/fetch queries without physically removing the row.
- **25.3** — A hard-delete (permanent removal) path may be provided separately; the soft-delete mechanism must not block it.

## Data Compatibility Assessment

| Concern | Assessment |
|---------|------------|
| Existing rows | All existing `Conversation` rows will have `deletedAt = NULL` after migration, which correctly indicates "not deleted". No data backfill is required. |
| Application queries | Any query that lists active conversations **must** add `WHERE "deletedAt" IS NULL` (or the Prisma equivalent `where: { deletedAt: null }`) to exclude soft-deleted rows. Failure to do so is safe (extra rows returned) but logically incorrect. |
| Indexes | No index is added on `deletedAt` in this migration. If query volume on soft-deleted conversations is high, consider adding `CREATE INDEX "Conversation_deletedAt_idx" ON "Conversation"("deletedAt")` in a follow-up migration. |
| Rollback safety | The rollback script (`rollback.sql`) drops the column with `IF EXISTS`, making it idempotent. Dropping a nullable column with no dependent constraints is non-destructive for existing data outside this column. |
| Zero-downtime deployment | Adding a nullable column with no default is a backwards-compatible DDL operation on PostgreSQL and can be applied without locking the table for extended periods. |
