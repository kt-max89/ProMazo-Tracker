---
name: User-referencing FK delete rules
description: Delete behavior for foreign keys that reference the users table
---

Deleting a `users` row must not error. Trace every FK chain transitively, not just tables that directly reference `users.id` — a cascade can still get blocked downstream (e.g. deleting a user's chat session cascades, but that session's own child rows need their own cascade rule too).

Current intended delete rules for all FKs pointing at `users.id`: `SET NULL` for fields that should survive the user (task creator, comment author), `CASCADE` for rows that only make sense while the user exists (assignments, chat sessions + their messages, citations). `projects.created_by` was removed entirely (column dropped).

**Why:** these FKs were originally `NO ACTION`, which blocked deleting any user with related data anywhere in the chain.

**How to apply:** `drizzle-kit push` prompted destructively/interactively for this schema and does not reliably alter existing FK delete rules — apply `ALTER TABLE ... DROP CONSTRAINT` + `ADD CONSTRAINT ... ON DELETE ...` directly via SQL (see `drizzle/0001_user_delete_fk_rules.sql`), then keep `references()` in `server/schema.ts` in sync. `documents.uploaded_by` remains `NO ACTION` by design (documents/uploads are a separate concern).

Startup repairs must inspect `pg_constraint.confdeltype` and only run `ALTER TABLE` when the rule is wrong. Do not call startup DDL from database tests that run in parallel with table-access tests; PostgreSQL can deadlock on their conflicting relation locks.

**Why:** An unconditional foreign-key repair in a parallel test run deadlocked with another test selecting and inserting task data.

**How to apply:** Keep startup schema repairs idempotent at the constraint-definition level, and let the normal application startup establish schema before service-level tests execute.
