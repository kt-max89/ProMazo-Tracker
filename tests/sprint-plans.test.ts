import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSprintPlanSchema, updateSprintPlanSchema } from "../shared/schema";
import { applySprintPlanSchema } from "../server/sprintPlanMigration";

test("plan validation preserves Markdown and disallows reassignment and unknown fields", () => {
  const content = "  ## Sprint 68\n\n- **Goal**\n";
  assert.equal(createSprintPlanSchema.parse({ sprintId: 1, content }).content, content);
  for (const sprintId of [null, 0, -1, 1.2, "1"]) {
    assert.equal(createSprintPlanSchema.safeParse({ sprintId, content }).success, false);
  }
  assert.equal(updateSprintPlanSchema.safeParse({ content, sprintId: 2 }).success, false);
  assert.equal(updateSprintPlanSchema.safeParse({ content: "x".repeat(100001) }).success, false);
  assert.equal(updateSprintPlanSchema.safeParse({ content: "" }).success, true);
});

test("isolated database/API plan lifecycle, concurrent duplicates and project/sprint integrity", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const originalUrl = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString: originalUrl });
  const schema = `plans_test_${randomUUID().replaceAll("-", "")}`;
  let appPool: Pool | undefined;
  let server: import("node:http").Server | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE TABLE "${schema}".projects (id serial PRIMARY KEY, name text, description text);
      CREATE TABLE "${schema}".sprints (id serial PRIMARY KEY, number integer UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE "${schema}".tracker_settings (id integer PRIMARY KEY, current_sprint_id integer REFERENCES "${schema}".sprints(id),
        sprint_68_backfill_completed boolean NOT NULL DEFAULT false, initial_admin_configured boolean NOT NULL DEFAULT false);
      INSERT INTO "${schema}".projects(name,description) VALUES ('One','Keep overview'), ('Two','Other overview');
      INSERT INTO "${schema}".sprints(number) VALUES (68),(69);
      INSERT INTO "${schema}".tracker_settings(id,current_sprint_id) VALUES (1,1);
    `);
    const url = new URL(originalUrl);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    appPool = (await import("../server/db")).pool;
    await applySprintPlanSchema(appPool);
    await applySprintPlanSchema(appPool);
    const service = await import("../server/sprintPlanService");
    assert.deepEqual(await service.listSprintPlans(1), []);
    await assert.rejects(service.createSprintPlan(99, { sprintId: 1, content: "" }), /Project not found/);
    await assert.rejects(service.createSprintPlan(1, { sprintId: 99, content: "" }), /Sprint not found/);
    const content = "## Sprint 68\n### Sprint Overview\n\n1. Keep all lines\n<script>unsafe</script>\n";
    const raced = await Promise.allSettled([
      service.createSprintPlan(1, { sprintId: 1, content }),
      service.createSprintPlan(1, { sprintId: 1, content: "Do not overwrite" }),
    ]);
    assert.equal(raced.filter(r => r.status === "fulfilled").length, 1);
    const rejected = raced.find(r => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    const plan = (await service.listSprintPlans(1))[0];
    assert.equal(rejected.reason.existingPlan.id, plan.id);
    const historical = await service.createSprintPlan(1, { sprintId: 2, content: "Historical" });
    await service.createSprintPlan(2, { sprintId: 1, content: "Other project" });
    await assert.rejects(service.updateSprintPlan(2, plan.id, "Wrong project"), /Sprint plan not found/);
    const updated = await service.updateSprintPlan(1, plan.id, content);
    assert.equal(updated.content, content);
    assert.equal(updated.sprintId, 1);
    assert.equal((await service.getSprintPlan(1, historical.id)).content, "Historical");
    assert.equal((await service.listSprintPlans(2))[0].content, "Other project");
    const settings = await import("../server/sprintService");
    await settings.setCurrentSprint(2);
    assert.equal((await settings.getTrackerSettings()).currentSprintId, 2);
    assert.equal((await service.getSprintPlan(1, plan.id)).sprintId, 1);
    assert.equal((await service.getSprintPlan(1, historical.id)).sprintId, 2);
    await assert.rejects(settings.setCurrentSprint(99), /Sprint not found/);
    assert.deepEqual((await service.listSprintPlans(1)).map(p => p.sprintNumber), [69, 68]);
    assert.equal((await appPool.query("SELECT description FROM projects WHERE id=1")).rows[0].description, "Keep overview");
    const reconnect = new Pool({ connectionString: url.toString() });
    try { assert.equal((await reconnect.query("SELECT content FROM project_sprint_plans WHERE id=$1", [plan.id])).rows[0].content, content); }
    finally { await reconnect.end(); }
    await assert.rejects(appPool.query("INSERT INTO project_sprint_plans(project_id,sprint_id,content) VALUES (1,1,'duplicate')"), /unique/);
    await assert.rejects(appPool.query("INSERT INTO project_sprint_plans(project_id,sprint_id,content) VALUES (1,99,'bad')"), /foreign key/);

    // Unit harness supplies authentication state only here; running app is unchanged.
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.isAuthenticated = (() => req.headers.authorization === "test-user") as typeof req.isAuthenticated;
      req.user = { isActive: true } as Express.User;
      next();
    });
    (await import("../server/sprintPlanRoutes")).registerSprintPlanRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server!.once("listening", resolve));
    const address = server.address() as import("node:net").AddressInfo;
    async function request(method: string, path: string, data?: unknown, signedIn = true) {
      return fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { "Content-Type": "application/json", ...(signedIn ? { authorization: "test-user" } : {}) },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
    }
    for (const method of ["GET", "POST", "PATCH"]) {
      assert.equal((await request(method, "/api/projects/1/sprint-plans" + (method === "PATCH" ? `/${plan.id}` : ""), method === "GET" ? undefined : { content: "no", sprintId: 1 }, false)).status, 401);
    }
    assert.equal((await request("GET", "/api/projects/bad/sprint-plans")).status, 400);
    assert.equal((await request("GET", "/api/projects/99/sprint-plans")).status, 404);
    assert.equal((await request("POST", "/api/projects/1/sprint-plans", { sprintId: 0, content: "bad" })).status, 400);
    const duplicate = await request("POST", "/api/projects/1/sprint-plans", { sprintId: 1, content: "overwrite" });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).existingPlan.content, content);
    assert.equal((await request("GET", `/api/projects/2/sprint-plans/${plan.id}`)).status, 404);
    assert.equal((await request("PATCH", `/api/projects/1/sprint-plans/${plan.id}`, { content: "Reassigned", sprintId: 2 })).status, 400);
    const saved = await request("PATCH", `/api/projects/1/sprint-plans/${plan.id}`, { content: "API saved\n" });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).content, "API saved\n");
    assert.equal((await request("GET", `/api/projects/1/sprint-plans/${plan.id}`)).status, 200);
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    process.env.DATABASE_URL = originalUrl;
    if (appPool) await appPool.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});