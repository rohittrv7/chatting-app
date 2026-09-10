# Database Migration & Baselining Documentation

## Overview

This document records the Prisma migration baselining process performed on the backend database.

## Background & Baselining Context

During early development, database schema iterations were applied using `prisma db push`, which synced PostgreSQL schemas directly without maintaining Prisma's migration history table (`_prisma_migrations`).

To prevent collisions, duplicate column errors, or deployment failures when running `prisma migrate deploy` in staging/production, the database was formally **baselined** using `prisma migrate resolve --applied <migration_name>` on 2026-09-10.

## Baselined Migrations

All 5 existing migration files in `apps/backend/prisma/migrations` are tracked and marked as applied in `_prisma_migrations`:

| Migration Name                               | Description                                                                                             | Status in DB |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| `20260801000000_init`                        | Initial PostgreSQL schema setup                                                                         | Applied ✅   |
| `20260801000001_add_conversation_deleted_at` | Conversation soft delete column                                                                         | Applied ✅   |
| `20260802000000_scalability_fixes`           | Scalability indexes & schema adjustments                                                                | Applied ✅   |
| `20260803000000_local_first_relay`           | Local-first relay architecture (`ciphertexts` nullable, `contentClearedAt`, `AttachmentDownload` table) | Applied ✅   |
| `20260910000000_add_about_visibility`        | User about/bio privacy controls (`aboutVisibility` column on `Setting`)                                 | Applied ✅   |

## Verification Command

To verify that the database schema and migration history are completely in sync:

```bash
pnpm --filter @chat/backend exec prisma migrate status
```

Output:

```text
5 migrations found in prisma/migrations
Database schema is up to date!
```

## Guidelines for Future Development

### 1. Creating New Schema Migrations (Development)

When making changes to `schema.prisma`, **do not** use raw `db push`. Use the standard Prisma migration flow:

```bash
pnpm --filter @chat/backend exec prisma migrate dev --name <describe_change>
```

Prisma will generate a new migration file under `prisma/migrations/` and apply it to your local database.

### 2. Deploying Migrations (Production / Staging / CI/CD)

To apply pending migrations without prompts in production:

```bash
pnpm --filter @chat/backend exec prisma migrate deploy
```

Because the database is already baselined, it will safely execute only newly added migrations.
