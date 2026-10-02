import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { insertTeamSchema, teamMembershipSchema, insertProjectSchema, updateTeamSchema, insertMilestoneSchema } from "../shared/schema";
import { applyTeamWorkspaceSchema } from "../server/teamWorkspaceMigration";

test("workspace inputs accept multiple teams, exclusions and empty contracts, reject invalid references", () => {
  assert.deepEqual(insertTeamSchema.parse({ name: " Shared " }), { name: "Shared", projectIds: [] });
  assert.equal(insertTeamSchema.safeParse({ name: " " }).success, false);
  assert.equal(teamMembershipSchema.safeParse({ teamId: null }).success, true);
  assert.equal(teamMembershipSchema.safeParse({ teamId: [1, 2] }).success, false);
  assert.equal(insertProjectSchema.safeParse({ name: "P", teamIds: [1, 2] }).success, true);
  assert.equal(insertProjectSchema.safeParse({ name: "P", teamIds: [-1] }).success, false);
  assert.equal(insertMilestoneSchema.safeParse({ name: "M", projectId: 1, excludedSprintIds: [0] }).success, false);
  assert.equal(updateTeamSchema.safeParse({ socialContract: "" }).success, true);
  assert.equal(updateTeamSchema.safeParse({ socialContract: null }).success, false);
});

test("legacy backfill, shared links, concurrency, exclusions/future defaults, contracts and task independence persist", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const originalUrl = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString: originalUrl });
  const schema = `teams_test_${randomUUID().replaceAll("-", "")}`;
  let appPool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE TABLE "${schema}".teams (id serial PRIMARY KEY, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${schema}".users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
        role text NOT NULL DEFAULT 'user', display_name text NOT NULL, team_id integer REFERENCES "${schema}".teams(id),
        is_active boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 0);
      CREATE TABLE "${schema}".projects (id serial PRIMARY KEY, name text NOT NULL, description text, timeline text,
        team_id integer REFERENCES "${schema}".teams(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${schema}".milestones (id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES "${schema}".projects(id),
        name text NOT NULL, description text, timeline text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${schema}".sprints (id serial PRIMARY KEY, number integer NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${schema}".tasks (id serial PRIMARY KEY, title text NOT NULL, project_id integer REFERENCES "${schema}".projects(id),
        milestone_id integer REFERENCES "${schema}".milestones(id), sprint_id integer REFERENCES "${schema}".sprints(id));
      INSERT INTO "${schema}".teams (name) VALUES ('Legacy team');
      INSERT INTO "${schema}".users (email,password_hash,display_name) VALUES ('test@example.com','unused','Tester'), ('other@example.com','unused','Other');
      INSERT INTO "${schema}".projects (name,description,timeline,team_id) VALUES ('Legacy','## History','Q4',1), ('Second','Keep this',null,null);
      INSERT INTO "${schema}".milestones (project_id,name,timeline) VALUES (1,'Legacy milestone','Historical timeline');
      INSERT INTO "${schema}".sprints (number) VALUES (68),(69);
      INSERT INTO "${schema}".tasks (title,project_id,milestone_id,sprint_id) VALUES ('Do not move',1,1,1);
    `);
    const isolatedUrl = new URL(originalUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    const database = await import("../server/db");
    appPool = database.pool;
    await applyTeamWorkspaceSchema(appPool);
    await applyTeamWorkspaceSchema(appPool);
    const { createTeam, listTeams, switchTeam, changeProjectLink, updateTeam, getTeam } = await import("../server/teamService");
    const { listProjects, getProject, updateProject, createProject } = await import("../server/projectService");
    const { getMilestone, createMilestone, updateMilestone } = await import("../server/milestoneService");
    const { createNextSprint } = await import("../server/sprintService");
    assert.deepEqual((await getProject(1))?.teamIds, [1]);
    const taskBefore = (await appPool.query("SELECT * FROM tasks")).rows;
    const a = await createTeam(1, "Shared", [1, 1]);
    assert.deepEqual((await getProject(1))?.teamIds, [1, a.id]);
    const before = await listTeams();
    await assert.rejects(createTeam(1, "Bad", [1, 999999]), /Project not found/);
    assert.deepEqual(await listTeams(), before);
    assert.equal((await appPool.query("SELECT team_id FROM users WHERE id=1")).rows[0].team_id, a.id);
    const raced = await Promise.all([createTeam(1, "Race one", [2]), createTeam(2, "Race two", [2])]);
    assert.deepEqual((await getProject(2))?.teamIds, raced.map(t => t.id).sort((a,b) => a-b));
    await changeProjectLink(a.id, 1, true);
    assert.deepEqual((await getProject(1))?.teamIds, [1, a.id]);
    await changeProjectLink(1, 1, false);
    await applyTeamWorkspaceSchema(appPool);
    assert.deepEqual((await getProject(1))?.teamIds, [a.id], "repeat migration does not resurrect removal");
    await changeProjectLink(a.id, 1, false);
    assert.deepEqual((await getProject(1))?.teamIds, []);
    await assert.rejects(changeProjectLink(a.id, 999999, true), /Project not found/);
    await assert.rejects(updateProject(1, { teamIds: [a.id, 999999] }), /Team not found/);
    assert.deepEqual((await getProject(1))?.teamIds, []);
    await updateProject(1, { teamIds: [a.id, raced[0].id, a.id] });
    await updateProject(1, { description: "# Updated" });
    assert.equal((await getProject(1))?.teamIds.length, 2);
    await switchTeam(1, raced[0].id);
    await switchTeam(1, null);
    await assert.rejects(switchTeam(1, 999999), /Team not found/);
    assert.equal((await appPool.query("SELECT team_id FROM users WHERE id=1")).rows[0].team_id, null);
    assert.deepEqual((await getMilestone(1))?.sprintIds.sort(), [1, 2]);
    const m = await createMilestone({ projectId: 1, name: "New" });
    assert.deepEqual(m.sprintIds.sort(), [1, 2]);
    await updateMilestone(1, { excludedSprintIds: [1, 1] });
    assert.deepEqual((await getMilestone(1))?.sprintIds, [2]);
    await assert.rejects(updateMilestone(1, { excludedSprintIds: [999999] }), /Sprint not found/);
    const next = await createNextSprint();
    assert.deepEqual((await getMilestone(1))?.sprintIds.sort(), [2, next.id].sort());
    assert.ok((await getMilestone(m.id))?.sprintIds.includes(next.id));
    await updateMilestone(m.id, { excludedSprintIds: [1,2,next.id] });
    assert.deepEqual((await getMilestone(m.id))?.sprintIds, []);
    await updateMilestone(1, { excludedSprintIds: [] });
    assert.equal((await getMilestone(1))?.sprintIds.length, 3);
    assert.equal((await getMilestone(1))?.timeline, "Historical timeline");
    assert.equal((await getProject(1))?.timeline, "Q4");
    await assert.rejects(createProject({ name: "Atomic", teamIds: [a.id] }, [{ name: "Bad", excludedSprintIds: [999999] }]), /Sprint not found/);
    assert.ok(!(await listProjects()).some(p => p.name === "Atomic"));
    const drafted = await createProject({ name: "Drafts", teamIds: [a.id] }, [{ name: "Draft", excludedSprintIds: [1] }]);
    assert.deepEqual((await appPool.query("SELECT excluded_sprint_ids FROM milestones WHERE project_id=$1", [drafted.id])).rows[0].excluded_sprint_ids, [1]);
    const contract = "# Agreement\nFirst line\nSecond line\n\n- **Respect**\n\n" + "long ".repeat(2000);
    await updateTeam(a.id, contract);
    assert.equal((await getTeam(a.id))?.socialContract, contract);
    const reconnect = new Pool({ connectionString: isolatedUrl.toString() });
    try {
      assert.equal((await reconnect.query("SELECT social_contract FROM teams WHERE id=$1",[a.id])).rows[0].social_contract, contract);
      assert.deepEqual((await reconnect.query("SELECT excluded_sprint_ids FROM milestones WHERE id=$1",[m.id])).rows[0].excluded_sprint_ids, [1,2,next.id]);
    } finally { await reconnect.end(); }
    await updateTeam(a.id, "");
    assert.equal((await getTeam(a.id))?.socialContract, "");
    assert.deepEqual((await appPool.query("SELECT * FROM tasks")).rows, taskBefore);
    assert.equal((await listProjects()).filter(p => p.id === 1).length, 1);
    // Managed Publish may apply schema before a data backfill. Legacy links
    // remain readable and are materialized before any individual add/drop.
    await appPool.query("DELETE FROM project_teams WHERE project_id=2");
    const legacy = (await getProject(2))!;
    assert.ok(legacy.teamIds.length > 0);
    await changeProjectLink(a.id, 2, true);
    assert.ok((await getProject(2))?.teamIds.includes(legacy.teamIds[0]));
  } finally {
    process.env.DATABASE_URL = originalUrl;
    if (appPool) await appPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});