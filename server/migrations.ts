/**
 * One-time data migrations that run on server startup.
 * Each migration is idempotent — safe to run multiple times.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Clear stored allowedUsers email lists from all documents.
 *
 * Background: the UI previously let admins store per-document email allow-lists.
 * That feature has been removed — the UI now always sends allowedUsers: [] and
 * the backend treats an empty list as "all users have access". Documents saved
 * before the change may still carry non-empty lists that would silently lock
 * users out. This migration resets them all to [] in one pass.
 */
async function clearDocumentAllowedUsers(): Promise<void> {
  const result = await db.execute(
    sql`UPDATE documents
        SET allowed_users = '[]'::jsonb
        WHERE allowed_users IS NOT NULL
          AND jsonb_array_length(allowed_users) > 0`
  );
  const count = (result as any).rowCount ?? 0;
  if (count > 0) {
    console.log(`[migrations] Cleared allowedUsers from ${count} document(s)`);
  }
}

/**
 * Creates the tracker-wide sprint model and assigns the tickets that existed
 * before sprints to Sprint 68 exactly once. The completion flag means future
 * tickets deliberately put in Backlog are never touched by a restart.
 */
async function initializeSprints(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sprints (
      id SERIAL PRIMARY KEY,
      number INTEGER NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tracker_settings (
      id INTEGER PRIMARY KEY,
      current_sprint_id INTEGER REFERENCES sprints(id),
      sprint_68_backfill_completed BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await db.execute(sql`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS sprint_id INTEGER REFERENCES sprints(id)
  `);
  await db.execute(sql`
    INSERT INTO sprints (number) VALUES (68)
    ON CONFLICT (number) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO tracker_settings (id, current_sprint_id, sprint_68_backfill_completed)
    VALUES (1, (SELECT id FROM sprints WHERE number = 68), false)
    ON CONFLICT (id) DO NOTHING
  `);
  await db.execute(sql`
    UPDATE tasks
    SET sprint_id = (SELECT id FROM sprints WHERE number = 68)
    WHERE sprint_id IS NULL
      AND NOT (SELECT sprint_68_backfill_completed FROM tracker_settings WHERE id = 1)
  `);
  await db.execute(sql`
    UPDATE tracker_settings
    SET sprint_68_backfill_completed = true,
        current_sprint_id = COALESCE(current_sprint_id, (SELECT id FROM sprints WHERE number = 68))
    WHERE id = 1 AND sprint_68_backfill_completed = false
  `);
}

export async function runMigrations(): Promise<void> {
  await clearDocumentAllowedUsers();
  await initializeSprints();
}
