// Opt-in development check: real login and approval, controlled model proposals.
// Only disposable fixture records are changed or removed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const suffix = randomUUID().slice(0, 8), password = randomUUID();
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const userIds: number[] = [], teamIds: number[] = [], projectIds: number[] = [];
let drafts: any[] = [];
let failDirectory = false;
let releaseDirectory: (() => void) | undefined;
let directoryHold: Promise<void> | undefined;
const taskTitle = (label: string) => `${label} ${suffix}`;
const getTasks = async () => (await (await context.request.get("/api/tasks")).json()).filter((task: any) => task.createdBy === userIds[0]);
async function propose(tasks: any[]) {
  drafts = tasks;
  await page.getByTestId("input-query").fill("Review fixture tasks");
  await page.getByTestId("button-send").click();
  await expect(page.getByTestId("proposal-modal")).toBeVisible();
}
async function openAssignees(index = 0) {
  const refreshed = page.waitForResponse(response => response.url().endsWith("/api/users"));
  await page.getByTestId(`proposal-row-${index}-assignee`).click();
  await refreshed;
  await expect(page.getByText("Loading current team members…")).not.toBeVisible({ timeout: 15_000 });
}
async function closeDropdown() {
  await expect(page.getByRole("menu", { name: "Choose task assignees" })).toBeVisible();
  // Wait for Radix's menu focus before issuing a keyboard dismissal.
  await expect.poll(() => page.getByRole("menu").evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
}
async function approve() {
  await expect(page.getByTestId("button-proposal-create")).toBeEnabled();
  await page.getByTestId("button-proposal-create").click();
  await expect(page.getByTestId("proposal-modal")).not.toBeVisible();
}

try {
  for (const name of ["Review team", "Other team"]) {
    const { rows } = await pool.query("INSERT INTO teams(name) VALUES($1) RETURNING id", [`${name} ${suffix}`]);
    teamIds.push(rows[0].id);
  }
  const names = ["Reviewer", "Bea", "Alex", "Alex", "Outside", "Inactive", "No team"];
  const hash = await bcrypt.hash(password, 4);
  for (let index = 0; index < names.length; index++) {
    const { rows } = await pool.query(
      "INSERT INTO users(email,password_hash,display_name,role,team_id,is_active) VALUES($1,$2,$3,'user',$4,$5) RETURNING id",
      [`review-${index}-${suffix}@example.test`, hash, names[index], index === 6 ? null : teamIds[index === 4 ? 1 : 0], index !== 5]);
    userIds.push(rows[0].id);
  }
  const { rows: projectRows } = await pool.query("INSERT INTO projects(name) VALUES($1) RETURNING id", [taskTitle("Review project")]);
  projectIds.push(projectRows[0].id);
  const { rows: milestoneRows } = await pool.query("INSERT INTO milestones(project_id,name) VALUES($1,$2) RETURNING id", [projectIds[0], taskTitle("Review milestone")]);
  const settings = await (await context.request.post("/api/auth/login", {
    data: { email: `review-0-${suffix}@example.test`, password },
  })).json();
  assert.equal(settings.id, userIds[0]);
  const sprintSettings = await (await context.request.get("/api/sprint-settings")).json();
  await page.route("**/api/chat", route => route.fulfill({
    contentType: "text/event-stream",
    body: `data: {"type":"done"}\n\ndata: ${JSON.stringify({ type: "task_proposal", data: { proposalId: randomUUID(), type: "create_task", tasks: drafts } })}\n\n`,
  }));
  await page.route("**/api/users", async route => {
    if (directoryHold) await directoryHold;
    if (failDirectory) await route.fulfill({ status: 503, json: { message: "Directory fixture failure" } });
    else await route.continue();
  });
  await page.goto("/");
  directoryHold = new Promise(resolve => { releaseDirectory = resolve; });
  await propose([
    { title: taskTitle("Multiple"), assignedToName: "Bea", description: "## What & Why\nPreserve Markdown." },
    { title: taskTitle("Ambiguous"), assignedToName: "Alex" },
    { title: taskTitle("Unavailable"), assignedToName: "Inactive" },
  ]);
  await expect(page.getByText("Loading current team members…")).toBeVisible();
  await page.getByTestId("proposal-row-0-title").fill(taskTitle("Multiple edited"));
  await expect(page.getByTestId("button-proposal-create")).toBeDisabled();
  directoryHold = undefined;
  releaseDirectory!();
  await expect(page.getByRole("button", { name: "Remove Bea", exact: true })).toBeVisible();
  await openAssignees();
  for (const id of [userIds[4], userIds[5], userIds[6]]) {
    await expect(page.getByTestId(`proposal-assignee-option-${id}`)).toHaveCount(0);
  }
  // Same display names are distinct choices with emails and stable IDs.
  for (const id of [userIds[2], userIds[3]]) await page.getByTestId(`proposal-assignee-option-${id}`).click();
  await closeDropdown();
  await page.getByRole("button", { name: "Next task", exact: true }).click();
  await expect(page.getByText(/Suggested assignee "Alex" is ambiguous/)).toBeVisible();
  await openAssignees(1);
  await page.getByTestId(`proposal-assignee-option-${userIds[3]}`).click();
  await closeDropdown();
  await page.getByTestId("proposal-row-1-project").selectOption(taskTitle("Review project"));
  await page.getByTestId("proposal-row-1-milestone").selectOption(taskTitle("Review milestone"));
  await page.getByTestId("proposal-row-1-sprint").selectOption("backlog");
  await page.getByTestId("proposal-row-1-size").selectOption("M");
  await page.getByTestId("proposal-row-1-duedate").fill("2026-12-31");
  await page.getByTestId("proposal-row-1-description").fill("## Edited\nKeep this exactly.");
  await page.getByRole("button", { name: "Previous task", exact: true }).click();
  await expect(page.getByRole("list", { name: "Selected assignees" }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByTestId("proposal-row-0-title")).toHaveValue(taskTitle("Multiple edited"));
  await page.getByRole("button", { name: "Go to task 3" }).click();
  await expect(page.getByText(/Suggested assignee "Inactive" is unavailable/)).toBeVisible();
  await approve();
  const saved = await getTasks();
  assert.equal(saved.length, 3);
  const multiple = saved.find((task: any) => task.title === taskTitle("Multiple edited"));
  assert.deepEqual(multiple.assigneeIds.sort(), [userIds[1], userIds[2], userIds[3]].sort());
  assert.equal(multiple.sprintId, sprintSettings.currentSprintId);
  assert.equal(multiple.description, "## What & Why\nPreserve Markdown.");
  const edited = saved.find((task: any) => task.title === taskTitle("Ambiguous"));
  assert.deepEqual(edited.assigneeIds, [userIds[3]]);
  assert.equal(edited.projectId, projectIds[0]);
  assert.equal(edited.milestoneId, milestoneRows[0].id);
  assert.equal(edited.sprintId, null);
  assert.equal(edited.size, "M");
  assert.equal(edited.dueDate, "2026-12-31");
  assert.equal(edited.description, "## Edited\nKeep this exactly.");
  assert.deepEqual(saved.find((task: any) => task.title === taskTitle("Unavailable")).assigneeIds, []);
  await page.goto(`/tasks/${multiple.id}`);
  await expect(page.getByText("Bea", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Alex", { exact: true }).first()).toBeVisible();
  await page.goto("/tasks");
  await page.getByRole("combobox").filter({ hasText: "My team" }).click();
  await page.getByRole("option", { name: "All teams", exact: true }).click();
  await expect(page.getByTestId(`text-assignee-${multiple.id}`)).toContainText("Bea, Alex, Alex");

  await page.goto("/");
  await propose([{ title: taskTitle("Cleared"), assignedToName: "Bea" }]);
  assert.equal((await getTasks()).length, 3, "proposals remain read-only until explicit approval");
  await page.setViewportSize({ width: 390, height: 844 });
  // Removal is a real keyboard-accessible button, not a nested click-only badge.
  await page.getByRole("button", { name: "Remove Bea", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("proposal-row-0-description").fill("Clearing stays explicit");
  await openAssignees();
  await closeDropdown();
  await approve();
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.deepEqual((await getTasks()).find((task: any) => task.title === taskTitle("Cleared")).assigneeIds, []);

  await propose([{ title: taskTitle("Stale"), assignedToName: "Bea" }]);
  await expect(page.getByRole("button", { name: "Remove Bea", exact: true })).toBeVisible();
  failDirectory = true;
  await openAssignees();
  await closeDropdown();
  await expect(page.getByText(/Could not load team members/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Remove Bea", exact: true })).toBeVisible();
  await expect(page.getByTestId("button-proposal-create")).toBeDisabled();
  failDirectory = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("button-proposal-create")).toBeEnabled();
  await pool.query("UPDATE users SET is_active=false WHERE id=$1", [userIds[1]]);
  await openAssignees();
  await closeDropdown();
  await expect(page.getByText(/A selected person is no longer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Bea", exact: true })).toBeVisible();
  await expect(page.getByTestId("button-proposal-create")).toBeDisabled();
  const countBefore = (await getTasks()).length;
  for (const invalid of [userIds[1], userIds[4], userIds[6], 99999999]) {
    const response = await context.request.post("/api/task-proposals/approve", {
      data: { tasks: [{ title: taskTitle("Must not create"), assigneeIds: [] }, { title: "Invalid", assigneeIds: [invalid] }] },
    });
    assert.equal(response.status(), 400);
    assert.match((await response.json()).message, /Task 2.*Remove/);
    assert.equal((await getTasks()).length, countBefore);
  }
  const malformed = await context.request.post("/api/task-proposals/approve", {
    data: { tasks: [{ title: "Valid", assigneeIds: [] }, { title: "Invalid", assigneeIds: ["oops"] }] },
  });
  assert.equal(malformed.status(), 400);
  assert.equal((await getTasks()).length, countBefore);
  await page.getByRole("button", { name: "Remove Bea", exact: true }).click();
  await approve();

  await propose([{ title: taskTitle("Membership changed"), assigneeIds: [userIds[2]] }]);
  await pool.query("UPDATE users SET team_id=$1 WHERE id=$2", [teamIds[1], userIds[2]]);
  await openAssignees();
  await closeDropdown();
  await expect(page.getByText(/A selected person is no longer/)).toBeVisible();
  const moved = await context.request.post("/api/task-proposals/approve", {
    data: { tasks: [{ title: "Moved", assigneeIds: [userIds[2]] }] },
  });
  assert.equal(moved.status(), 400);
  await context.request.patch("/api/teams/membership", { data: { teamId: null } });
  await openAssignees();
  await expect(page.getByTestId(`proposal-assignee-option-${userIds[6]}`)).toHaveCount(0);
  await closeDropdown();
  await expect(page.getByText(/You are not on a team/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Alex", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove Alex", exact: true }).click();
  await approve();
  await propose([{ title: taskTitle("No team"), assignedToName: "Reviewer" }]);
  await expect(page.getByText(/You are not on a team/)).toBeVisible();
  await openAssignees();
  await expect(page.getByRole("menuitemcheckbox")).toHaveCount(0);
  await closeDropdown();
  await approve();
  assert.deepEqual((await getTasks()).find((task: any) => task.title === taskTitle("No team")).assigneeIds, []);
  assert.deepEqual(errors, []);
  console.log("PASS: signed-in multi-selection, per-task persistence, legacy ambiguity, eligibility, loading/error/refetch preservation, no-team state, stale approval rejection, saved board/detail assignments and unchanged planning fields.");
} catch (error) {
  console.error("Browser assertion failed:", error);
  throw error;
} finally {
  releaseDirectory?.();
  await context.close();
  await browser.close();
  if (userIds.length) {
    await pool.query("DELETE FROM task_assignees WHERE task_id IN (SELECT id FROM tasks WHERE created_by = ANY($1::int[]))", [userIds]);
    await pool.query("DELETE FROM tasks WHERE created_by = ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id = ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM milestones WHERE project_id = ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id = ANY($1::int[])", [projectIds]);
  }
  if (teamIds.length) await pool.query("DELETE FROM teams WHERE id = ANY($1::int[])", [teamIds]);
  await pool.end();
}
