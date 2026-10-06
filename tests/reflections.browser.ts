import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { pool } from "../server/db";

const baseURL = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID(), password = randomUUID();
const userIds: number[] = [], reflectionIds: number[] = [], sprintIds: number[] = [];
const contexts: BrowserContext[] = [];
const secondURL = "http://127.0.0.1:5014";
let second = spawn(process.execPath, ["dist/index.cjs"], {
  env: { ...process.env, NODE_ENV: "production", PORT: "5014" }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
const attachLogs = () => {
  second.stdout?.on("data", chunk => { serverLog += chunk.toString(); });
  second.stderr?.on("data", chunk => { serverLog += chunk.toString(); });
};
attachLogs();
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${secondURL}/api/auth/me`)).status === 401) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Secondary server failed: ${serverLog.slice(-2000)}`);
}
async function context(email: string, base = baseURL) {
  const ctx = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
  contexts.push(ctx);
  await api(ctx, "POST", "/api/auth/login", { email, password });
  return ctx;
}
async function api(ctx: BrowserContext, method: string, path: string, data?: unknown) {
  const response = await ctx.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
try {
  await ready();
  const hash = await bcrypt.hash(password, 4);
  const emails = ["owner", "member", "admin"].map(role => `reflection-${role}-${suffix}@example.test`);
  const users = await pool.query(`INSERT INTO users(email,password_hash,display_name,role)
    VALUES($1,$4,'Reflection Owner','user'),($2,$4,'Reflection Member','user'),($3,$4,'Reflection Admin','admin') RETURNING id`, [...emails, hash]);
  userIds.push(...users.rows.map(row => row.id));
  const owner = await context(emails[0]), member = await context(emails[1]), admin = await context(emails[2]);
  const remoteOwner = await context(emails[0], secondURL);
  const settings = await api(owner, "GET", "/api/sprint-settings");
  const sprints = await api(owner, "GET", "/api/sprints");
  const sprint = sprints.find((row: { id: number }) => row.id === settings.currentSprintId);
  assert.ok(sprint, "Current sprint must exist");
  const other = (await pool.query("INSERT INTO sprints(number) VALUES($1) RETURNING id,number", [4000000 + Math.floor(Math.random() * 1000000)])).rows[0];
  sprintIds.push(other.id);
  const input = {
    sprintId: sprint.id, summary: `Private summary ${suffix}`,
    wastes: [{ category: "wastefulness", description: "First original waste" }, { category: "overload", description: "Second original waste" }],
    kaizenWhat: "Original what", kaizenWhy: "Original why", kaizenDone: "Original done", impact: "Original impact",
  };
  const reflection = await api(owner, "POST", "/api/reflections", input);
  const locked = await api(owner, "POST", "/api/reflections", { ...input, sprintId: other.id, summary: `Other sprint secret ${suffix}` });
  reflectionIds.push(reflection.id, locked.id);
  for (const path of ["/api/reflections", "/api/reflections/recent", `/api/reflections?sprintId=${sprint.id}&authorId=${userIds[0]}`]) {
    const data = await api(member, "GET", path);
    assert.equal(data.some((row: { id: number }) => reflectionIds.includes(row.id)), false);
  }
  assert.equal((await member.request.get(`/api/reflections/${reflection.id}`)).status(), 403);
  const body = { additions: [{ field: "summary", text: "Unauthorized addition" }] };
  for (const ctx of [member, admin]) assert.equal((await ctx.request.post(`/api/reflections/${reflection.id}/additions`, { data: body })).status(), 403);
  for (const data of [
    { ...body, authorId: userIds[2] }, { ...body, sprintId: other.id },
    { additions: [{ field: "summary", text: " " }] },
    { additions: [{ field: "summary", text: input.summary }] },
    { additions: [{ field: "wasteDescription", text: "Bad target", wasteIndex: 99 }] },
  ]) assert.equal((await owner.request.post(`/api/reflections/${reflection.id}/additions`, { data })).status(), 400);
  assert.equal((await owner.request.patch(`/api/reflections/${reflection.id}`, { data: { summary: "Replace" } })).status(), 405);
  const anon = await browser.newContext({ baseURL }); contexts.push(anon);
  assert.equal((await anon.request.get("/api/reflections/access")).status(), 401);
  const pageM = await member.newPage(), pageO = await owner.newPage(), pageA = await admin.newPage();
  const errors: string[] = [];
  for (const page of [pageM, pageO, pageA]) page.on("pageerror", error => errors.push(error.message));
  await pageM.goto("/team-overview");
  await expect(pageM.getByTestId("current-sprint-reflection-access")).toContainText("Submit");
  await expect(pageM.getByTestId(`row-reflection-${reflection.id}`)).toHaveCount(0);
  await pageM.goto("/reflections");
  await expect(pageM.getByTestId(`button-submit-reflection-sprint-${sprint.id}`)).toBeVisible();
  await expect(pageM.getByTestId(`row-reflection-${reflection.id}`)).toHaveCount(0);
  await pageM.getByTestId(`button-submit-reflection-sprint-${sprint.id}`).click();
  const form = pageM.getByTestId("dialog-reflection-form");
  await expect(form.getByTestId("select-reflection-sprint")).toContainText(`Sprint ${sprint.number}`);
  await form.getByTestId("input-reflection-summary").fill("Member submitted summary");
  const textareas = form.locator("textarea");
  await textareas.nth(1).fill("Member what");
  await textareas.nth(2).fill("Member why");
  await textareas.nth(3).fill("Member done");
  await textareas.nth(4).fill("Member impact");
  const wastes = form.getByPlaceholder("Describe the waste you observed");
  await wastes.nth(0).fill("Member waste one"); await wastes.nth(1).fill("Member waste two");
  await form.getByRole("button", { name: "Submit reflection", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(pageM.getByTestId(`row-reflection-${reflection.id}`)).toBeVisible();
  const ownRows = await api(member, "GET", `/api/reflections?authorId=${userIds[1]}`);
  reflectionIds.push(...ownRows.map((row: { id: number }) => row.id));
  await expect(pageM.getByTestId(`row-reflection-${locked.id}`)).toHaveCount(0);
  await expect(pageM.getByTestId(`button-submit-reflection-sprint-${other.id}`)).toBeVisible();
  assert.equal((await member.request.get(`/api/reflections/${locked.id}`)).status(), 403);
  await pageM.getByTestId(`row-reflection-${reflection.id}`).getByRole("button").click();
  await expect(pageM.getByTestId("form-reflection-addition")).toHaveCount(0);
  await expect(pageM.getByTestId("dialog-reflection-detail")).toContainText(input.summary);
  await pageM.keyboard.press("Escape");
  await pageA.goto("/reflections");
  await expect(pageA.getByTestId(`row-reflection-${locked.id}`)).toBeVisible();
  await pageA.getByTestId(`row-reflection-${reflection.id}`).getByRole("button").click();
  await expect(pageA.getByTestId("form-reflection-addition")).toHaveCount(0);
  await pageO.goto("/reflections");
  await pageO.getByTestId(`row-reflection-${reflection.id}`).getByRole("button").click();
  const detail = pageO.getByTestId("dialog-reflection-detail");
  await expect(pageO.getByTestId("form-reflection-addition")).toBeVisible();
  await pageO.getByTestId("input-reflection-addition-summary").fill("Browser summary addition");
  await pageO.getByTestId("input-reflection-addition-original-0").fill("Browser waste context");
  await pageO.getByTestId("button-add-reflection-waste").click();
  await pageO.getByTestId("select-addition-waste-category-0").click();
  await pageO.getByRole("option", { name: "Imbalance", exact: true }).click();
  await pageO.getByTestId("input-addition-new-waste-0").fill("Browser added waste");
  await pageO.getByTestId("button-submit-reflection-addition").click();
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("Browser summary addition");
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("Original waste 1");
  await expect(pageO.getByTestId("input-reflection-addition-summary")).toHaveValue("");
  await expect(detail).toContainText(input.summary);
  // Independent sessions and servers append to the same reflection; neither replaces history.
  await pageO.getByTestId("input-reflection-addition-impact").fill("Unsaved impact draft");
  await api(remoteOwner, "POST", `/api/reflections/${reflection.id}/additions`, { additions: [{ field: "kaizenWhy", text: "Remote live addition" }] });
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("Remote live addition", { timeout: 12000 });
  await expect(pageO.getByTestId("input-reflection-addition-impact")).toHaveValue("Unsaved impact draft");
  await expect(pageA.getByTestId("reflection-addition-history")).toContainText("Remote live addition", { timeout: 12000 });
  await pageO.getByTestId("button-submit-reflection-addition").click();
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("Unsaved impact draft");
  await Promise.all(["API concurrent one", "API concurrent two"].map(text =>
    api(owner, "POST", `/api/reflections/${reflection.id}/additions`, { additions: [{ field: "impact", text }] })));
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("API concurrent two", { timeout: 12000 });
  const beforeRestart = await api(owner, "GET", `/api/reflections/${reflection.id}`);
  assert.equal(beforeRestart.summary, input.summary);
  assert.equal(beforeRestart.createdAt, reflection.createdAt);
  await pageO.reload();
  await pageO.getByTestId(`row-reflection-${reflection.id}`).getByRole("button").click();
  await expect(pageO.getByTestId("reflection-addition-history")).toContainText("API concurrent one");
  // Restart a disposable second app server, not the user's workflow.
  second.kill("SIGTERM");
  await new Promise(resolve => second.once("exit", resolve));
  second = spawn(process.execPath, ["dist/index.cjs"], { env: { ...process.env, NODE_ENV: "production", PORT: "5014" }, stdio: ["ignore", "pipe", "pipe"] });
  attachLogs(); await ready();
  const persisted = await api(remoteOwner, "GET", `/api/reflections/${reflection.id}`);
  assert.deepEqual(persisted, beforeRestart);
  // Losing administrator access must remove cached bypass reads in an open detail.
  await api(admin, "PATCH", `/api/admin/users/${userIds[2]}`, { action: "demote" });
  await expect(pageA.getByTestId("reflection-addition-history")).toHaveCount(0, { timeout: 12000 });
  await expect(pageA.getByTestId("dialog-reflection-detail")).toContainText("locked");
  assert.equal((await admin.request.get(`/api/reflections/${reflection.id}`)).status(), 403);
  await pageM.goto("/team-overview");
  await expect(pageM.getByTestId(`row-reflection-${reflection.id}`)).toBeVisible();
  await expect(pageM.getByTestId(`row-reflection-${locked.id}`)).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS: member submit-first/unlock, admin read-only, owner append UI, API guards, concurrent saves, reload/restart persistence, cross-server draft-safe live detail refresh");
} finally {
  second.kill("SIGTERM");
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  // Include form submissions even when an assertion fails before IDs are captured.
  await pool.query("DELETE FROM reflections WHERE author_id=ANY($1::int[])", [userIds]);
  await pool.query("DELETE FROM sprints WHERE id=ANY($1::int[])", [sprintIds]);
  await pool.query("DELETE FROM presence_leases WHERE user_id=ANY($1::int[])", [userIds]);
  await pool.query("DELETE FROM session WHERE (sess->'passport'->'user'->>'id')::int=ANY($1::int[])", [userIds]);
  await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  await pool.end();
}
