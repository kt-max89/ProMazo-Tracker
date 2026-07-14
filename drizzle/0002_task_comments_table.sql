-- Create the task_comments table and apply correct FK constraints.
-- Applied manually against the live database; committed here for reproducibility.

CREATE TABLE IF NOT EXISTS task_comments (
  id          SERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL
                REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   INTEGER
                REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
