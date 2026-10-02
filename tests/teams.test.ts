import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { insertTeamSchema, teamMembershipSchema, insertProjectSchema } from "../shared/schema";

test("team inputs allow duplicate names and empty claims, reject invalid references", () => {
  assert.deepEqual(insertTeamSchema.parse({ name: " Shared " }), { name: "Shared", projectIds: [] });
  assert.equal(insertTeamSchema.safeParse({ name: " " }).success, false);
  assert.equal(insertTeamSchema.safeParse({ name: "Team", projectIds: [-1] }).success, false);
  assert.equal(teamMembershipSchema.safeParse({ teamId: null }).success, true);
  assert.equal(teamMembershipSchema.safeParse({ teamId: 0 }).success, false);
  assert.equal(insertProjectSchema.safeParse({ name: "Project", teamId: null }).success, true);
});

test("legacy migration, atomic claims, switching, descriptions, and reconnection persistence", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const originalUrl = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString: originalUrl });
  const schema = `teams_test_${randomUUID().replaceAll("-", "")}`;
  let appPool: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE TABLE "${schema}".users (
        id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user', display_name TEXT NOT NULL);
      CREATE TABLE "${schema}".projects (
        id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT, timeline TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      INSERT INTO "${schema}".users (email,password_hash,display_name) VALUES ('legacy@example.com','test','Legacy');
      INSERT INTO "${schema}".projects (name,description) VALUES ('Legacy','## Existing overview'), ('Second','Keep this');
    `);
    const isolatedUrl = new URL(originalUrl);
    isolatedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    const database = await import("../server/db");
    appPool = database.pool;
    const { initializeTeams } = await import("../server/migrations");
    const { createTeam, listTeams, switchTeam, TeamClaimConflict } = await import("../server/teamService");
    const { listProjects, getProject, updateProject, createProject } = await import("../server/projectService");
    const { storage } = await import("../server/storage");
    await initializeTeams();
    await initializeTeams();
    assert.equal((await storage.getUser(1))?.teamId, null);
    assert.equal((await getProject(1))?.teamId, null);
    assert.equal((await getProject(1))?.description, "## Existing overview");
    const a = await createTeam(1, "Same name", [1, 1]);
    assert.equal((await storage.getUser(1))?.teamId, a.id);
    assert.equal((await getProject(1))?.teamId, a.id);
    const before = await listTeams();
    await assert.rejects(createTeam(1, "Failed claim", [1, 2]), TeamClaimConflict);
    assert.deepEqual(await listTeams(), before);
    assert.equal((await getProject(2))?.teamId, null);
    assert.equal((await storage.getUser(1))?.teamId, a.id);
    await assert.rejects(createTeam(1, "Missing project", [999999]), TeamClaimConflict);
    const b = await createTeam(1, "Same name", []);
    assert.notEqual(b.id, a.id);
    await switchTeam(1, a.id);
    await switchTeam(1, b.id);
    assert.equal((await storage.getUser(1))?.teamId, b.id);
    await assert.rejects(switchTeam(1, 999999), /Team not found/);
    await switchTeam(1, null);
    assert.equal((await storage.getUser(1))?.teamId, null);
    await updateProject(1, { teamId: b.id, description: "# Saved\n\n**Markdown**" });
    assert.equal((await getProject(1))?.teamId, b.id);
    assert.equal((await getProject(1))?.description, "# Saved\n\n**Markdown**");
    await updateProject(1, { teamId: null });
    assert.equal((await getProject(1))?.teamId, null);
    await assert.rejects(updateProject(1, { teamId: 999999 }), /Team not found/);
    const p = await createProject({ name: "New", teamId: a.id });
    assert.equal(p.teamId, a.id);
    const u = await storage.createUser({ email: "other@example.com", displayName: "Other", role: "user", passwordHash: "test" });
    const results = await Promise.allSettled([
      createTeam(1, "Race one", [2]), createTeam(u.id, "Race two", [2]),
    ]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.filter(r => r.status === "rejected" && r.reason instanceof TeamClaimConflict).length, 1);
    assert.equal((await listTeams()).length, 3);
    const snapshot = await listProjects();
    // A new physical connection sees committed ownership, not process memory.
    const restarted = new Pool({ connectionString: isolatedUrl.toString() });
    try {
      const rows = await restarted.query("SELECT id, team_id FROM projects ORDER BY id");
      assert.deepEqual(rows.rows, snapshot.sort((x, y) => x.id - y.id).map(p => ({ id: p.id, team_id: p.teamId })));
    } finally { await restarted.end(); }
    await initializeTeams();
    assert.equal((await getProject(1))?.description, "# Saved\n\n**Markdown**");
  } finally {
    process.env.DATABASE_URL = originalUrl;
    if (appPool) await appPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});