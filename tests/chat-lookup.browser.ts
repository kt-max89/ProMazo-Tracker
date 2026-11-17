// Opt-in live-provider verification. No auth bypass: disposable account, normal
// login, real SSE endpoint, real readers, and the existing review UI.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID().replaceAll("-", "");
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [], events: any[] = [];
const userIds: number[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", async response => {
  if (response.url().endsWith("/api/chat") && response.request().method() === "POST") {
    const body = await response.text();
    for (const line of body.split("\n").filter(line => line.startsWith("data: "))) events.push(JSON.parse(line.slice(6)));
  }
});
try {
  const password = randomUUID(), email = `lookup-${suffix}@example.test`, name = `Sarah${suffix}`;
  const users = await pool.query("INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3),($4,$2,$3) RETURNING id",
    [email, await bcrypt.hash(password, 4), name, `lookup-other-${suffix}@example.test`]);
  userIds.push(...users.rows.map(u => u.id));
  assert.equal((await context.request.post("/api/auth/login", { data: { email, password } })).status(), 200);
  const title = `Onboarding deck ${suffix}`;
  const created = await context.request.post("/api/tasks", { data: { title, sprintId: null } });
  assert.equal(created.status(), 200);
  const task = await created.json();
  await page.goto("/");
  const input = page.getByTestId("input-query");
  await input.fill(`Look up tasks: first search query "absent${suffix}" and inspect the results. If empty, retry see_tasks with query "${suffix}". Tell me the matching task ID and title. This is read-only, do not draft anything.`);
  await input.press("Enter");
  await expect(input).toBeEnabled({ timeout: 150000 });
  await expect.poll(() => events.some(e => e.type === "done")).toBe(true);
  assert.ok(events.filter(e => e.type === "route" && e.data === "SEE_TASKS").length >= 2);
  assert.ok(events.some(e => e.type === "token" && e.data.includes(String(task.id))));
  assert.ok(!events.some(e => /proposal/.test(e.type)));
  await expect(page.getByTestId("tool-indicator-1")).toContainText("(again)");
  const sessions = await (await context.request.get("/api/chat-sessions")).json();
  assert.ok(sessions.length > 0);

  events.length = 0;
  await input.fill(`Draft a new task to revise the onboarding deck ${suffix} with a checklist for accessibility. Assign it to "${name}". Search for related work and people first. I want a proposal for review even if a similar task exists, but explicitly identify possible duplicates and ambiguous assignees. No project or milestone.`);
  await input.press("Enter");
  await expect(page.getByTestId("proposal-modal")).toBeVisible({ timeout: 150000 });
  await expect.poll(() => events.some(e => e.type === "task_proposal")).toBe(true);
  assert.ok(events.some(e => e.type === "route" && e.data === "SEE_TASKS"));
  const answer = events.filter(e => e.type === "token").map(e => e.data).join("");
  assert.match(answer, new RegExp(String(task.id)));
  assert.match(answer, /ambiguous|two|multiple/i);
  assert.equal(Number((await pool.query("SELECT count(*) FROM tasks WHERE created_by=$1", [userIds[0]])).rows[0].count), 1);
  assert.ok(events.findIndex(e => e.type === "done") < events.findIndex(e => e.type === "task_proposal"));
  assert.deepEqual(errors, []);
  console.log("PASS: live Sonnet read/retry, repeated progress, related-task lookup, duplicate/ambiguous-name review, saved conversation, proposal event ordering, no writes before approval.");
} finally {
  await context.request.post("/api/auth/logout").catch(() => {});
  await browser.close();
  if (userIds.length) {
    await pool.query("DELETE FROM task_activity WHERE task_id IN (SELECT id FROM tasks WHERE created_by=ANY($1::int[]))", [userIds]);
    await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE created_by=ANY($1::int[]))", [userIds]);
    await pool.query("DELETE FROM tasks WHERE created_by=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id=ANY($1::int[]))", [userIds]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM presence_leases WHERE user_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  }
  await pool.end();
}
