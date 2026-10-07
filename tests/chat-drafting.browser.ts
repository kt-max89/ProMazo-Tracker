// Focused opt-in browser verification against the running development app.
// Uses a disposable account and removes only records owned by that account.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";
import bcrypt from "bcrypt";

const baseURL = process.env.CHAT_TEST_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
const browser = await chromium.launch({
  executablePath: process.env.CHAT_TEST_CHROMIUM_PATH ||
    (existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined),
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  baseURL, viewport: { width: 1280, height: 800 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const suffix = randomUUID();
let userId: number | undefined;
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));

try {
  // Fixture login avoids depending on the workspace's private registration code.
  const email = `draft-${suffix}@example.test`, password = randomUUID();
  const fixture = await pool.query("INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3) RETURNING id",
    [email, await bcrypt.hash(password, 4), `Draft Test ${suffix}`]);
  userId = fixture.rows[0].id;
  const registration = await context.request.post("/api/auth/login", {
    data: { email, password },
  });
  assert.equal(registration.status(), 200);
  userId = (await registration.json()).id;
  await page.goto("/");
  const input = page.getByTestId("input-query");
  const send = page.getByTestId("button-send");
  await expect(input).toBeVisible();
  await page.getByTestId("button-close-sidebar").click();
  const height = () => input.evaluate(element => element.getBoundingClientRect().height);
  const baseline = await height();
  await expect(send).toBeDisabled();
  await input.fill(" ");
  await expect(send).toBeDisabled();
  await input.fill("First line");
  await input.press("Shift+Enter");
  await input.pressSequentially("Second line");
  assert.ok((await input.inputValue()).includes("\n"));
  assert.ok(await height() > baseline);
  await page.evaluate(() => navigator.clipboard.writeText("line\n".repeat(100)));
  await input.press("Control+A");
  await input.press("Control+V");
  await expect(input).toHaveValue("line\n".repeat(100));
  await expect.poll(height).toBeLessThanOrEqual(240);
  assert.ok(await input.evaluate(element => element.scrollHeight > element.clientHeight));
  await expect(send).toBeInViewport();
  await input.fill("Short");
  await expect.poll(height).toBe(baseline);
  await input.fill("A wrapped draft with enough text to change its height. ".repeat(5));
  const wideHeight = await height();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(height).toBeGreaterThan(wideHeight);
  await input.fill("line\n".repeat(100));
  assert.ok(await input.evaluate(element => element.scrollHeight > element.clientHeight));
  await expect(send).toBeInViewport();
  await page.getByTestId("button-open-sidebar").click();
  await page.getByTestId("button-new-chat").click();
  await expect(input).toHaveValue("");
  await expect.poll(height).toBe(baseline);
  await page.getByTestId("button-close-sidebar").click();
  await page.setViewportSize({ width: 1280, height: 800 });

  // Hold a controlled response to observe the streaming guard deterministically.
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/chat", async route => {
    await held;
    await route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"token","data":"Keyboard verified."}\n\ndata: {"type":"done"}\n\n',
    });
  });
  await input.fill("Keyboard verification\nsecond line");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeDisabled();
  await expect(send).toBeDisabled();
  await expect.poll(height).toBe(baseline);
  release();
  await expect(input).toBeEnabled();
  await expect(page.getByTestId("text-user-message-0")).toHaveText("Keyboard verification\nsecond line");
  await page.unroute("**/api/chat");

  const title = `Draft verification ${suffix}`;
  await input.fill(`Propose a task titled "${title}" to create a meeting agenda with sections for current blockers and next actions. Completion criteria: the agenda contains both sections and each next action has an owner field. No resources provided. No project. Show me the proposal for review.`);
  await input.press("Enter");
  const modal = page.getByTestId("proposal-modal");
  await expect(modal).toBeVisible({ timeout: 120_000 });
  const description = page.getByTestId("proposal-row-0-description");
  const generated = await description.inputValue();
  assert.deepEqual(generated.match(/^## .+$/gm), ["## What & Why", "## Steps", "## Resources / Context"]);
  assert.ok(generated.indexOf("### Definition of Done") > generated.indexOf("## Resources / Context"));
  const criteria = generated.split("### Definition of Done")[1];
  assert.match(criteria, /blockers/i);
  assert.match(criteria, /next actions/i);
  assert.match(criteria, /owner/i);
  const edited = `${generated}\n- Owner fields may be left blank until the meeting.`;
  await description.fill(edited);
  const before = await (await context.request.get("/api/tasks")).json();
  assert.ok(!before.some((task: any) => task.title === title));
  await page.getByTestId("button-proposal-create").click();
  await expect(modal).not.toBeVisible();
  const saved = (await (await context.request.get("/api/tasks")).json())
    .find((task: any) => task.title === title);
  assert.ok(saved);
  assert.equal(saved.description, edited);
  await page.goto(`/tasks/${saved.id}`);
  await expect(page.getByRole("heading", { name: "Definition of Done", exact: true })).toBeVisible();
  await expect(page.getByText("Owner fields may be left blank until the meeting.", { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("PASS: desktop/mobile growth, wrapping, scrolling, deletion, New Chat, keyboard, streaming guards, live generation, review editing, approval, saved description and markdown display.");
  console.log(JSON.stringify({ baseline, wideHeight, generatedDescription: generated }));
} finally {
  await context.request.post("/api/auth/logout").catch(() => {});
  await context.close();
  await browser.close();
  if (userId !== undefined) {
    await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE created_by = $1)", [userId]);
    await pool.query("DELETE FROM task_activity WHERE task_id IN (SELECT id FROM tasks WHERE created_by = $1)", [userId]);
    await pool.query("DELETE FROM tasks WHERE created_by = $1", [userId]);
    await pool.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id = $1)", [userId]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM presence_leases WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  await pool.end();
}