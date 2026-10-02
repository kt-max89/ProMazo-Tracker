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

/**
 * Creates the shared team post feed. The nullable author reference preserves
 * posts when the author is deleted; the API joins the current display name
 * when one is available and the UI supplies the deleted-author fallback.
 */
async function initializeTeamPosts(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS team_posts (
      id SERIAL PRIMARY KEY,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      pinned BOOLEAN NOT NULL DEFAULT false
    )
  `);
}

/**
 * Older databases were created before Needs review was added and can retain a
 * CHECK constraint that rejects needs_review even though the application accepts
 * it. Replacing the named constraint is safe to repeat and preserves all rows.
 */
async function repairTaskStatusConstraint(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass
          AND conname = 'tasks_status_check'
          AND pg_get_constraintdef(oid) LIKE '%needs_review%'
      ) THEN
        ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
        ALTER TABLE tasks
          ADD CONSTRAINT tasks_status_check
          CHECK (status IN ('not_started', 'in_progress', 'needs_review', 'done'));
      END IF;
    END
    $$;
  `);
}

/**
 * Creates sprint reflections after the shared sprint model is initialized.
 * The author name is stored as a snapshot so submitted reflections remain
 * attributable if a user account is later removed.
 */
async function initializeReflections(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS reflections (
      id SERIAL PRIMARY KEY,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      sprint_id INTEGER NOT NULL REFERENCES sprints(id),
      summary TEXT NOT NULL,
      wastes JSONB NOT NULL,
      kaizen_what TEXT NOT NULL,
      kaizen_why TEXT NOT NULL,
      kaizen_done TEXT NOT NULL,
      impact TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function initializeTaskActivity(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS task_activity (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS task_activity_task_created_idx
    ON task_activity (task_id, created_at, id)
  `);
}

async function repairTaskUserDeleteRules(): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tasks'::regclass
          AND conname = 'tasks_created_by_fkey'
          AND confdeltype = 'n'
      ) THEN
        ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_created_by_fkey;
        ALTER TABLE tasks ADD CONSTRAINT tasks_created_by_fkey
          FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'task_assignees'::regclass
          AND conname = 'task_assignees_user_id_fkey'
          AND confdeltype = 'c'
      ) THEN
        ALTER TABLE task_assignees DROP CONSTRAINT IF EXISTS task_assignees_user_id_fkey;
        ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'task_comments'::regclass
          AND conname = 'task_comments_author_id_fkey'
          AND confdeltype = 'n'
      ) THEN
        ALTER TABLE task_comments DROP CONSTRAINT IF EXISTS task_comments_author_id_fkey;
        ALTER TABLE task_comments ADD CONSTRAINT task_comments_author_id_fkey
          FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    END
    $$;
  `);
}

export async function initializeTeams(): Promise<void> {
  // Additive and transactional: old records remain unassigned and intact.
  await db.transaction(async tx => {
    await tx.execute(sql`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await tx.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id)`);
    await tx.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id)`);
  });
}

export async function runMigrations(): Promise<void> {
  await initializeTeams();
  await clearDocumentAllowedUsers();
  await initializeSprints();
  await initializeTeamPosts();
  await initializeReflections();
  await initializeTaskActivity();
  await repairTaskUserDeleteRules();
  await repairTaskStatusConstraint();
}
