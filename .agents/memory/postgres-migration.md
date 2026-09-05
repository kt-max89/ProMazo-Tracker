---
name: PostgreSQL migration architecture
description: How the app stores data after the file-based → Postgres migration; common pitfalls and schema decisions.
---

## Architecture

- **`server/schema.ts`** — Drizzle `pgTable` definitions for 8 tables: users, documents, chunks, citations, chat_sessions, chat_messages, projects, tasks. Keep client imports away from this file (it's server-only).
- **`server/db.ts`** — exports `pool` (pg.Pool, shared with connect-pg-simple) and `db` (drizzle client).
- **`server/storage.ts`** — `DatabaseStorage` implements `IStorage`; cosine similarity done in JS (no pgvector). Also exports `storage = new DatabaseStorage()`.
- **`server/taskService.ts` / `server/projectService.ts`** — Drizzle queries; mappers convert `Date` → `.toISOString()` for backward compat with domain types.
- **`server/auth.ts`** — sessions stored in `session` table via `connect-pg-simple`; `createTableIfMissing: true`.
- **`server/persist.ts`** — deleted; `data/` directory removed.
- **`drizzle.config.ts`** — points to `./server/schema.ts`; run `npx drizzle-kit push` for future schema changes.

## Pre-existing table pitfalls

Prior task-agent merges (Tasks #1–#3) created several tables before this migration. `CREATE TABLE IF NOT EXISTS` silently skipped them. Required manual `ALTER TABLE` to fix:
- Text timestamp columns → TIMESTAMPTZ (drop default, alter type, reset default)
- `chunks.embedding` was `vector` type (pgvector) → dropped and re-added as `jsonb`
- `documents.allowed_users` was `TEXT[]` → converted to `jsonb` via `to_json()`
- `tasks` was missing `project_id` column → added with `ALTER TABLE tasks ADD COLUMN`

**Why:** Any future schema change must check whether the table already exists and what columns it actually has. Do not assume CREATE TABLE ran successfully.

## Production check constraints

Production can retain an older check-constraint definition even when development already accepts newer application values. Declare business-critical constraints in the Drizzle schema source and let Replit's Publish flow reconcile development and production.

**Why:** A production-only status constraint still allowed the removed `blocked` value and rejected `needs_review`, while the application and development database used the current status set.

**How to apply:** When a value works in development but a production write fails with a check-constraint error, compare the constraint definitions. Fix the declarative schema and re-publish; never add startup DDL or directly mutate production.

## Delete semantics

- `DatabaseStorage.deleteDocument()` explicitly deletes chunks then document (not relying on CASCADE)
- `DatabaseStorage.deleteChatSession()` explicitly deletes messages then session (not relying on CASCADE)
- The cascade ON DELETE constraints on pre-existing tables were NOT applied (tables pre-existed the migration)

**How to apply:** Always explicitly delete child rows in service layer; don't rely solely on DB CASCADE for tables that may have been created before CASCADE was defined.

## Embedding storage

Stored as `jsonb` in `chunks.embedding`. Cosine similarity computed in JavaScript in `searchSimilarChunks`. The dimension guard (`a.length !== b.length`) prevents NaN scores from mismatched embeddings.
