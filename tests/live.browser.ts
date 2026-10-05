import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { pool } from "../server/db";

const baseURL = process.env.TEST_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const secondURL = "http://127.0.0.1:5013";
const suffix = randomUUID();
const password = randomUUID();
const userIds: number[] = [], taskIds: number[] = [], projectIds: number[] = [], teamIds: number[] = [], sprintIds: number[] = [];
const second = spawn(process.execPath, ["dist/index.cjs"], { env: { ...process.env, NODE_ENV: "production", PORT: "5013" }, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
second.stdout.on("data", chunk => { serverLog += chunk.toString(); });
second.stderr.on("data", chunk => { serverLog += chunk.toString(); });
const browser = await chromium.launch({ executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined, args: ["--no-sandbox"] });
const a = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const b = await browser.newContext({ baseURL: secondURL, viewport: { width: 1280, height: 900 } });
const anonymous = await browser.newContext({ baseURL });
const pageA = await a.newPage(), pageB = await b.newPage();
const errors: string[] = [];
const extras: BrowserContext[] = [];
pageA.on("pageerror", error => errors.push(error.message));
pageB.on("pageerror", error => errors.push(error.message));
pageA.on("dialog", dialog => dialog.accept());
const originalSprint = (await pool.query("SELECT current_sprint_id FROM tracker_settings WHERE id=1")).rows[0]?.current_sprint_id;
async function api(context: BrowserContext, method: string, path: string, data?: unknown) {
  const response = await context.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.status() === 204 ? undefined : response.json();
}
async function login(context: BrowserContext, email: string) {
  await api(context, "POST", "/api/auth/login", { email, password });
}
async function domainSeen(domain: string, action: () => Promise<unknown>) {
  await pageA.evaluate(() => { (window as any).liveTestDomains = []; });
  await action();
  await expect.poll(() => pageA.evaluate(() => (window as any).liveTestDomains), { timeout: 8000 }).toContain(domain);
}
async function captureEvents() {
  await pageA.evaluate(() => {
    (window as any).liveTestSource?.close();
    (window as any).liveTestDomains = [];
    const stream = new EventSource("/api/live/events");
    (window as any).liveTestSource = stream;
    stream.addEventListener("change", event => (window as any).liveTestDomains.push(JSON.parse((event as MessageEvent).data).domain));
    stream.addEventListener("revoked", () => { (window as any).wasRevoked = true; stream.close(); });
  });
}
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${secondURL}/api/auth/me`)).status === 401) break; } catch {}
    if (i === 99) throw new Error(`Second server failed to start: ${serverLog.slice(-2000)}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const hash = await bcrypt.hash(password, 4);
  const users = await pool.query("INSERT INTO users(email,password_hash,display_name,role) VALUES ($1,$2,$3,'admin'),($4,$2,$5,'user') RETURNING id", [
    `live-a-${suffix}@example.com`, hash, `Live Alpha ${suffix}`, `live-b-${suffix}@example.com`, `Live Beta ${suffix}`,
  ]);
  userIds.push(...users.rows.map(row => row.id));
  await login(a, `live-a-${suffix}@example.com`); await login(b, `live-b-${suffix}@example.com`);
  const statusA = await api(a, "GET", "/api/live/status"), statusB = await api(b, "GET", "/api/live/status");
  assert.equal(statusA.mode, "listen-notify"); assert.equal(statusB.mode, "listen-notify");
  assert.equal((await anonymous.request.get("/api/live/events")).status(), 401);
  assert.equal((await anonymous.request.post("/api/live/presence", { data: {} })).status(), 401);
  assert.equal((await a.request.post("/api/live/presence", { headers: { Origin: "https://evil.example" }, data: { tabId: randomUUID(), active: true, page: "tasks" } })).status(), 403);
  assert.equal((await a.request.post("/api/live/presence", { data: { tabId: randomUUID(), active: true, page: "Secret chat title" } })).status(), 400);
  const limitedTab = randomUUID();
  await api(a, "POST", "/api/live/presence", { tabId: limitedTab, active: true, page: "private" });
  assert.equal((await a.request.post("/api/live/presence", { data: { tabId: limitedTab, active: true, page: "private" } })).status(), 429);
  await api(a, "DELETE", `/api/live/presence/${limitedTab}`);
  const project = await api(b, "POST", "/api/projects", { name: `Live project ${suffix}`, description: "Original brief", milestones: [{ name: `Live milestone ${suffix}` }] });
  projectIds.push(project.id);
  const milestone = (await api(b, "GET", `/api/projects/${project.id}/milestones`))[0];
  const task = await api(b, "POST", "/api/tasks", { title: `Live task ${suffix}`, description: "Original description", projectId: project.id, milestoneId: milestone.id, sprintId: null });
  taskIds.push(task.id);
  await pageA.goto(`/tasks/${task.id}`); await pageB.goto(`/tasks/${task.id}`);
  await expect(pageA.getByTestId("live-presence")).toHaveAttribute("data-live-status", "live");
  await expect(pageA.getByTestId(`online-user-${userIds[1]}`)).toBeVisible({ timeout: 10000 });
  await captureEvents();
  await pageA.waitForTimeout(1200);
  await pageA.evaluate(() => { (window as any).liveTestDomains = []; });
  assert.equal((await b.request.patch(`/api/tasks/${task.id}`, { data: { title: "" } })).status(), 400);
  await pageA.waitForTimeout(1200);
  assert.deepEqual(await pageA.evaluate(() => (window as any).liveTestDomains), [], "failed mutations do not announce a save");
  await pageA.getByRole("textbox", { name: "Task title", exact: true }).fill("Unsaved Alpha title");
  await domainSeen("tasks", () => api(b, "PATCH", `/api/tasks/${task.id}`, { title: `Remote task ${suffix}`, status: "needs_review" }));
  await expect(pageA.getByText("Updated by someone else.", { exact: false })).toBeVisible();
  await expect(pageA.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue("Unsaved Alpha title");
  await domainSeen("tasks", () => api(b, "POST", `/api/tasks/${task.id}/comments`, { body: `Live comment ${suffix}` }));
  await expect(pageA.getByText(`Live comment ${suffix}`, { exact: true })).toBeVisible();
  await pageA.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(pageA.getByRole("textbox", { name: "Task title", exact: true })).toHaveValue(`Remote task ${suffix}`);
  await domainSeen("tasks", () => api(b, "POST", `/api/tasks/${task.id}/archive`));
  await expect(pageA.getByRole("button", { name: "Restore", exact: true })).toBeVisible();
  await domainSeen("tasks", () => api(b, "POST", `/api/tasks/${task.id}/restore`));
  await expect(pageA.getByRole("button", { name: "Archive", exact: true })).toBeVisible();
  await pageA.goto("/tasks");
  await pageA.getByTestId("select-sprint-filter").click();
  await pageA.getByRole("option", { name: "All sprints", exact: true }).click();
  await pageA.getByText(`Remote task ${suffix}`, { exact: true }).click();
  const panel = pageA.getByTestId("task-detail-panel");
  await panel.getByTestId("input-task-title").fill("Unsaved board panel");
  await api(b, "PATCH", `/api/tasks/${task.id}`, { title: `Remote panel task ${suffix}` });
  await expect(panel.getByText("Updated by someone else.", { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(panel.getByTestId("input-task-title")).toHaveValue("Unsaved board panel");
  await panel.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(panel.getByTestId("input-task-title")).toHaveValue(`Remote panel task ${suffix}`);
  await panel.getByTestId("button-close-task-panel").click();
  const proposal = await api(b, "POST", "/api/task-proposals/approve", { tasks: [{ title: `Live approved ${suffix}` }] });
  const approved = (await api(b, "GET", "/api/tasks")).find((item: any) => item.title === `Live approved ${suffix}`);
  assert.ok(proposal && approved); taskIds.push(approved.id);
  await expect(pageA.getByTestId(`card-task-${approved.id}`)).toBeVisible({ timeout: 8000 });

  await pageA.goto(`/projects/${project.id}`);
  await pageA.getByRole("button", { name: "Edit project", exact: true }).click();
  await pageA.getByRole("textbox", { name: "Project name", exact: true }).fill("Unsaved project name");
  await api(b, "PATCH", `/api/projects/${project.id}`, { name: `Remote project ${suffix}` });
  await expect(pageA.getByText("Updated by someone else.", { exact: false })).toBeVisible({ timeout: 8000 });
  await expect(pageA.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Unsaved project name");
  await pageA.getByRole("button", { name: "Discard draft and reload" }).click();
  await pageA.getByRole("button", { name: "Cancel", exact: true }).click();
  await captureEvents();
  await domainSeen("milestones", () => api(b, "PATCH", `/api/milestones/${milestone.id}`, { name: `Remote milestone ${suffix}` }));
  await expect(pageA.getByText(`Remote milestone ${suffix}`, { exact: true })).toBeVisible();
  let sprint: any;
  await domainSeen("sprints", async () => { sprint = await api(b, "POST", "/api/sprints/next"); });
  sprintIds.push(sprint.id);
  await domainSeen("sprints", () => api(b, "PATCH", "/api/sprint-settings/current", { sprintId: sprint.id }));
  const plan = await api(b, "POST", `/api/projects/${project.id}/sprint-plans`, { sprintId: sprint.id, content: "Original plan" });
  await expect(pageA.getByRole("button", { name: "Edit plan", exact: true })).toBeVisible({ timeout: 8000 });
  await pageA.getByRole("button", { name: "Edit plan", exact: true }).click();
  await pageA.getByRole("textbox", { name: "Sprint plan Markdown" }).fill("Unsaved plan");
  await domainSeen("plans", () => api(b, "PATCH", `/api/projects/${project.id}/sprint-plans/${plan.id}`, { content: "Remote plan" }));
  await expect(pageA.getByText("Updated by someone else.", { exact: false })).toBeVisible();
  await expect(pageA.getByRole("textbox", { name: "Sprint plan Markdown" })).toHaveValue("Unsaved plan");
  await api(b, "PATCH", "/api/sprint-settings/current", { sprintId: originalSprint });
  await expect(pageA.getByRole("textbox", { name: "Sprint plan Markdown" })).toHaveValue("Unsaved plan");
  await pageA.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(pageA.getByRole("textbox", { name: "Sprint plan Markdown" })).toHaveValue("Remote plan");

  const team = await api(b, "POST", "/api/teams", { name: `Live team ${suffix}`, projectIds: [project.id] });
  teamIds.push(team.id);
  await pageA.goto(`/teams/${team.id}`); await captureEvents();
  await pageA.getByRole("button", { name: "Edit contract" }).click();
  await pageA.getByRole("textbox", { name: "Social contract Markdown" }).fill("Unsaved agreement");
  await domainSeen("teams", () => api(b, "PATCH", `/api/teams/${team.id}`, { socialContract: "Remote agreement" }));
  await expect(pageA.getByText("Updated by someone else.", { exact: false })).toBeVisible();
  await expect(pageA.getByRole("textbox", { name: "Social contract Markdown" })).toHaveValue("Unsaved agreement");
  await domainSeen("teams", () => api(b, "PATCH", "/api/teams/membership", { teamId: team.id }));
  await expect(pageA.getByText(`Live Beta ${suffix}`, { exact: true })).toBeVisible();
  await domainSeen("teams", () => api(b, "DELETE", `/api/teams/${team.id}/projects/${project.id}`));
  await domainSeen("teams", () => api(b, "PUT", `/api/teams/${team.id}/projects/${project.id}`));
  let post: any;
  await domainSeen("posts", async () => { post = await api(b, "POST", "/api/team-posts", { body: `Live post ${suffix}` }); });
  await domainSeen("posts", () => api(b, "POST", `/api/team-posts/${post.id}/pin`));
  await domainSeen("reflections", () => api(b, "POST", "/api/reflections", {
    sprintId: sprint.id, summary: `Live reflection ${suffix}`,
    wastes: [{ category: "wastefulness", description: "Waiting" }, { category: "overload", description: "Too much" }],
    kaizenWhat: "Improve", kaizenWhy: "Flow", kaizenDone: "Done", impact: "Better",
  }));
  await pageA.goto("/team-overview");
  await pageA.getByTestId("button-add-team-update").click();
  await pageA.getByTestId("input-team-post").fill("Unsaved team post");
  await api(b, "POST", "/api/team-posts", { body: `Remote post while drafting ${suffix}` });
  await expect(pageA.getByText(`Remote post while drafting ${suffix}`, { exact: true })).toBeVisible({ timeout: 8000 });
  await expect(pageA.getByTestId("input-team-post")).toHaveValue("Unsaved team post");
  await pageA.getByTestId("button-add-reflection").click();
  await pageA.getByTestId("input-reflection-summary").fill("Unsaved reflection");
  const selectedSprint = await pageA.getByTestId("select-reflection-sprint").textContent();
  await api(b, "POST", "/api/reflections", {
    sprintId: sprint.id, summary: `Remote second reflection ${suffix}`,
    wastes: [{ category: "wastefulness", description: "Waiting" }, { category: "overload", description: "Too much" }],
    kaizenWhat: "Improve", kaizenWhy: "Flow", kaizenDone: "Done", impact: "Better",
  });
  await api(b, "PATCH", "/api/sprint-settings/current", { sprintId: sprint.id });
  await pageA.waitForTimeout(1500);
  await expect(pageA.getByTestId("input-reflection-summary")).toHaveValue("Unsaved reflection");
  assert.equal(await pageA.getByTestId("select-reflection-sprint").textContent(), selectedSprint, "remote sprint changes do not retarget reflection drafts");
  await pageA.getByTestId("dialog-reflection-form").getByRole("button", { name: "Close", exact: true }).click();
  await api(b, "PATCH", "/api/sprint-settings/current", { sprintId: originalSprint });
  await pageA.goto(`/tasks/${task.id}`); await captureEvents();
  await domainSeen("milestones", () => api(b, "DELETE", `/api/milestones/${milestone.id}`));
  await expect.poll(async () => (await api(a, "GET", `/api/tasks/${task.id}`)).milestoneId).toBeNull();
  await domainSeen("posts", () => api(b, "DELETE", `/api/team-posts/${post.id}`));
  await pageA.goto(`/teams/${team.id}`);
  await pageA.getByRole("button", { name: "Edit contract" }).click();
  await pageA.getByRole("textbox", { name: "Social contract Markdown" }).fill("Unsaved agreement");

  // Tabs share identity, not connection state; either surviving tab maintains online presence.
  const anotherTab = await b.newPage(); await anotherTab.goto("/team-overview");
  await expect.poll(async () => (await api(a, "GET", "/api/live/presence")).filter((item: any) => item.id === userIds[1]).length).toBe(1);
  await pageB.close();
  await expect.poll(async () => (await api(a, "GET", "/api/live/presence")).filter((item: any) => item.id === userIds[1]).length).toBe(1);
  const idleTab = randomUUID();
  await api(b, "POST", "/api/live/presence", { tabId: idleTab, page: "private", active: false });
  await pool.query("UPDATE presence_leases SET active=false WHERE user_id=$1", [userIds[1]]);
  await expect.poll(async () => (await api(a, "GET", "/api/live/presence")).find((item: any) => item.id === userIds[1])?.state).toBe("idle");
  await api(b, "POST", "/api/live/presence", { tabId: randomUUID(), page: "private", active: true });
  assert.equal((await api(a, "GET", "/api/live/presence")).find((item: any) => item.id === userIds[1]).page, "Private workspace");
  await a.setOffline(true);
  await expect(pageA.getByTestId("live-presence")).not.toHaveAttribute("data-live-status", "live", { timeout: 30000 });
  await api(b, "PATCH", `/api/teams/${team.id}`, { socialContract: "Saved while disconnected" });
  await expect(pageA.getByRole("textbox", { name: "Social contract Markdown" })).toHaveValue("Unsaved agreement");
  await a.setOffline(false); await pageA.bringToFront();
  await expect(pageA.getByTestId("live-presence")).toHaveAttribute("data-live-status", "live", { timeout: 35000 });
  await expect(pageA.getByRole("textbox", { name: "Social contract Markdown" })).toHaveValue("Unsaved agreement");
  await pageA.getByRole("button", { name: "Discard draft and reload" }).click();
  await expect(pageA.getByRole("textbox", { name: "Social contract Markdown" })).toHaveValue("Saved while disconnected");
  await anotherTab.close();
  await expect.poll(async () => (await api(a, "GET", "/api/live/presence")).some((item: any) => item.id === userIds[1]), { timeout: 50000 }).toBe(false);
  const freshTab = await b.newPage(); await freshTab.goto("/team-overview");
  await expect(freshTab.getByTestId("live-presence")).toHaveAttribute("data-live-status", "live");
  await api(b, "POST", "/api/auth/logout");
  await expect.poll(async () => (await api(a, "GET", "/api/live/presence")).some((item: any) => item.id === userIds[1])).toBe(false);
  assert.equal((await b.request.post("/api/live/presence", { data: { tabId: randomUUID(), page: "tasks", active: true } })).status(), 401);
  await login(b, `live-b-${suffix}@example.com`); await freshTab.reload();
  await expect(freshTab.getByTestId("live-presence")).toHaveAttribute("data-live-status", "live");
  await api(a, "PATCH", `/api/admin/users/${userIds[1]}`, { action: "deactivate" });
  await expect(freshTab.getByTestId("auth-page")).toBeVisible({ timeout: 15000 });
  assert.equal((await b.request.get("/api/live/events")).status(), 401);
  assert.equal((await b.request.post("/api/live/presence", { data: { tabId: randomUUID(), page: "private", active: true } })).status(), 401);
  await api(a, "PATCH", `/api/admin/users/${userIds[1]}`, { action: "reactivate" });
  assert.equal((await b.request.get("/api/auth/me")).status(), 401, "reactivation cannot revive revoked sessions");
  await login(b, `live-b-${suffix}@example.com`); await freshTab.reload();
  await expect(freshTab.getByTestId("live-presence")).toHaveAttribute("data-live-status", "live");
  await pool.query("UPDATE session SET expire=now()-interval '1 second' WHERE sess->'passport'->'user'->>'id'=$1", [String(userIds[1])]);
  await expect(freshTab.getByTestId("auth-page")).toBeVisible({ timeout: 15000 });
  // Fresh authenticated heartbeat snapshots support overflow without exposing destinations.
  for (let i = 0; i < 4; i++) {
    const email = `live-extra-${i}-${suffix}@example.com`;
    const row = (await pool.query("INSERT INTO users(email,password_hash,display_name,role) VALUES ($1,$2,$3,'user') RETURNING id", [email, hash, `Live Extra ${i}`])).rows[0];
    userIds.push(row.id);
    const context = await browser.newContext({ baseURL }); extras.push(context);
    await login(context, email);
    await api(context, "POST", "/api/live/presence", { tabId: randomUUID(), page: "private", active: true });
  }
  await expect(pageA.getByTestId("online-presence-overflow")).toBeVisible({ timeout: 8000 });
  await pageA.getByTestId("online-presence-overflow").click();
  await expect(pageA.getByLabel("Other online teammates").getByRole("list")).toContainText("Live Extra");
  await pageA.keyboard.press("Escape");
  await pageA.setViewportSize({ width: 402, height: 874 }); await pageA.reload();
  const overflow = await pageA.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `Mobile presence/header overflow: ${overflow}px`);
  for (const route of ["/tasks", "/my-tasks", "/projects", `/projects/${project.id}`, `/tasks/${task.id}`, "/reflections", "/history", "/admin", "/"]) {
    await pageA.goto(route);
    await expect(pageA.getByTestId("live-presence")).toBeVisible();
    const headerOverflow = await pageA.evaluate(() => {
      const header = document.querySelector("header:has([data-testid='live-presence'])")!;
      return [header, ...header.querySelectorAll("*")].filter(el => el.getBoundingClientRect().right > innerWidth + 1)
        .map(el => ({ tag: el.tagName, right: el.getBoundingClientRect().right }));
    });
    assert.deepEqual(headerOverflow, [], `mobile header must fit ${route}`);
  }
  assert.deepEqual(errors, []);
  console.log("Live browser tests passed: two independent servers, all shared event domains, preserved task/project/agreement/plan drafts, multiple tabs, safe locations, idle, reconnect, logout, deactivation, mobile.");
} finally {
  await a.close(); await b.close(); await anonymous.close(); await Promise.all(extras.map(context => context.close())); await browser.close();
  second.kill("SIGTERM");
  await pool.query("UPDATE tracker_settings SET current_sprint_id=$1 WHERE id=1", [originalSprint]);
  if (taskIds.length) {
    await pool.query("DELETE FROM task_assignees WHERE task_id=ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM tasks WHERE id=ANY($1::int[])", [taskIds]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM project_sprint_plans WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM milestones WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM project_teams WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id=ANY($1::int[])", [projectIds]);
  }
  if (userIds.length) {
    await pool.query("DELETE FROM team_posts WHERE author_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM reflections WHERE author_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM session WHERE (sess->'passport'->'user'->>'id')=ANY($1::text[])", [userIds.map(String)]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  }
  if (teamIds.length) await pool.query("DELETE FROM teams WHERE id=ANY($1::int[])", [teamIds]);
  if (sprintIds.length) await pool.query("DELETE FROM sprints WHERE id=ANY($1::int[])", [sprintIds]);
  await pool.end();
}