import type { Pool } from "pg";

// Explicit development/post-merge schema flow only. Production uses Publish.
export async function applySprintPlanSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS project_sprint_plans (
      id serial PRIMARY KEY,
      project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      sprint_id integer NOT NULL REFERENCES sprints(id),
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS project_sprint_plans_project_sprint_unique
      ON project_sprint_plans(project_id, sprint_id);
  `);
}