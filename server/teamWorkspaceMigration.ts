import type { Pool } from "pg";

// Called only by the explicit development/post-merge command and isolated tests.
export async function applyTeamWorkspaceSchema(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      ALTER TABLE teams ADD COLUMN IF NOT EXISTS social_contract text NOT NULL DEFAULT '';
      ALTER TABLE milestones ADD COLUMN IF NOT EXISTS excluded_sprint_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
      CREATE TABLE IF NOT EXISTS project_teams (
        project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        team_id integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, team_id)
      );
      CREATE INDEX IF NOT EXISTS project_teams_team_idx ON project_teams(team_id);
      INSERT INTO project_teams(project_id, team_id)
        SELECT id, team_id FROM projects WHERE team_id IS NOT NULL
        ON CONFLICT DO NOTHING;
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}