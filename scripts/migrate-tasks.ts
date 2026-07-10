import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const statements = [
  `CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'needs_review', 'done')),
    is_blocked BOOLEAN NOT NULL DEFAULT false,
    size TEXT,
    blocked_reason TEXT,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT now()::text,
    updated_at TEXT NOT NULL DEFAULT now()::text,
    created_by INTEGER REFERENCES users(id),
    archived_at TEXT
  )`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)`,
  // assigned_to is deprecated in favor of the task_assignees join table (see below), kept
  // as an ALTER for older DBs and dropped again at the end of this list.
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS size TEXT`,
  `CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    UNIQUE (task_id, user_id)
  )`,
  `DO $ BEGIN
    ALTER TABLE task_assignees ADD CONSTRAINT task_assignees_unique UNIQUE (task_id, user_id);
  EXCEPTION WHEN duplicate_table THEN NULL;
  END $`,
  `INSERT INTO task_assignees (task_id, user_id)
    SELECT id, assigned_to FROM tasks
    WHERE assigned_to IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = tasks.id AND ta.user_id = tasks.assigned_to
      )`,
  `ALTER TABLE tasks DROP COLUMN IF EXISTS assigned_to`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const sql of statements) {
      await client.query(sql);
    }
    console.log("Migration complete");
  } catch (err: any) {
    console.error("Error:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
