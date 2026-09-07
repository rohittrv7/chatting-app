# Migration: 20260802000000_scalability_fixes

## Pre-flight checklist

Run these queries **before** applying `migration.sql` on production:

```sql
-- 1. How many messages have deletedForUserIds entries?
SELECT COUNT(*) AS messages_with_deletions
FROM "Message"
WHERE array_length("deletedForUserIds", 1) > 0;

-- 2. How many total deletion entries will be backfilled?
SELECT SUM(array_length("deletedForUserIds", 1)) AS total_deletion_rows
FROM "Message"
WHERE array_length("deletedForUserIds", 1) > 0;

-- 3. How many Report rows need messageContent → decryptedContent backfill?
SELECT COUNT(*) FROM "Report";
```

## Post-migration verification

Run these queries **after** applying `migration.sql`:

```sql
-- Verify MessageDeletion count matches the old array sum
SELECT COUNT(*) AS new_deletion_rows FROM "MessageDeletion";
-- Should match "total_deletion_rows" from pre-flight step 2

-- Verify no Message rows still have deletedForUserIds column
SELECT column_name FROM information_schema.columns
WHERE table_name = 'Message' AND column_name = 'deletedForUserIds';
-- Should return 0 rows

-- Verify Report.messageContent column is gone
SELECT column_name FROM information_schema.columns
WHERE table_name = 'Report' AND column_name = 'messageContent';
-- Should return 0 rows

-- Verify new indexes exist
SELECT indexname FROM pg_indexes
WHERE tablename IN ('MessageDeletion', 'BlockedUser', 'RefreshToken', 'User')
ORDER BY tablename, indexname;
```

## Estimated downtime

- Zero downtime for steps 1, 3, 4, 5 (additive DDL, no locks needed).
- Step 2d (backfill) runs in a DO block — for tables with > 1M messages,
  run the INSERT in batches (see comment in migration.sql) during off-peak hours.
- Step 2e (DROP COLUMN) acquires an ACCESS EXCLUSIVE lock briefly — run during
  low-traffic window.

## Safe batch backfill (for large tables)

If the Message table has > 500k rows, replace step 2d with this loop
(run from psql until 0 rows affected):

```sql
DO $$
DECLARE inserted INT;
BEGIN
  LOOP
    WITH batch AS (
      SELECT m."id", unnest(m."deletedForUserIds") AS uid
      FROM "Message" m
      WHERE array_length(m."deletedForUserIds", 1) > 0
      LIMIT 5000
    )
    INSERT INTO "MessageDeletion" ("id", "messageId", "userId", "deletedAt")
    SELECT gen_random_uuid()::text, id, uid, NOW()
    FROM batch
    ON CONFLICT ("messageId", "userId") DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    EXIT WHEN inserted = 0;
    PERFORM pg_sleep(0.1); -- brief pause between batches
  END LOOP;
END $$;
```
