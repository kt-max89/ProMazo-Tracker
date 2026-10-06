import type { Pool } from "pg";

// Development/post-merge only. Production schema is applied by Publish.
export async function applyReflectionSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reflection_additions (
      id SERIAL PRIMARY KEY,
      reflection_id INTEGER NOT NULL REFERENCES reflections(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT NOT NULL,
      field TEXT NOT NULL,
      text TEXT NOT NULL,
      waste_index INTEGER,
      waste_addition_id INTEGER,
      category TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS reflection_additions_reflection_idx ON reflection_additions(reflection_id, id);
  `);
}
