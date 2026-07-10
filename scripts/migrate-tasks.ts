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
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS size TEXT`,
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
