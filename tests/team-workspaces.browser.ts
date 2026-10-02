// Opt-in integration/browser test. Creates and removes only disposable records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

const baseURL = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
const suffix = randomUUID().slice(0, 8);
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const projectIds: number[] = [], taskIds: number[] = [], teamIds: number[] = [];
let userId: number | undefined, oldSprintId: number | null = null, nextSprintId: number | undefined;
async function api(method: string, path: string, data?: unknown) {
  const response = await context.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function choose(testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function selectLabel(label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
try {
  const user = await api("POST", "/api/auth/register", {
    email: `teams-${suffix}@example.com`, password: `Disposable-${randomUUID()}`, displayName: `Teams Test ${suffix}`,
  });
  userId = user.id;
  assert.equal(user.teamId, null);
  assert.equal(user.passwordHash, undefined);
  const settings = await api("GET", "/api/sprint-settings");
  oldSprintId = settings.currentSprintId;
  const p = await api("POST", "/api/projects", { name: `Project ${suffix}`, description: "## Original overview\n\nPreserve **all** text.", timeline: "Q4", milestones: [{ name: "First milestone", timeline: "Week 1" }] });
  projectIds.push(p.id);
  const p2 = await api("POST", "/api/projects", { name: `Other project ${suffix}`, milestones: [{ name: "Other milestone" }] });
  projectIds.push(p2.id);
  const ms = await api("GET", `/api/projects/${p.id}/milestones`);
  const ms2 = await api("GET", `/api/projects/${p2.id}/milestones`);
  const own = await api("POST", "/api/tasks", { title: `Own ${suffix}`, projectId: p.id, milestoneId: ms[0].id });
  taskIds.push(own.id);
  const other = await api("POST", "/api/tasks", { title: `Other ${suffix}`, projectId: p2.id, milestoneId: ms2[0].id });
  taskIds.push(other.id);
  const loose = await api("POST", "/api/tasks", { title: `Loose ${suffix}` });
  taskIds.push(loose.id);
  await page.goto("/tasks");
  await expect(page.getByTestId("select-team-scope")).toContainText("All teams");
  await expect(page.getByTestId("select-current-sprint")).toHaveCount(0);
  await page.goto("/team-overview");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByPlaceholder("e.g. Platform delivery").fill(`Canceled ${suffix}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok(!(await api("GET", "/api/teams")).some((t: any) => t.name === `Canceled ${suffix}`));
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByPlaceholder("e.g. Platform delivery").fill(`Alpha ${suffix}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: p.name, exact: true }).check();
  await page.getByRole("button", { name: "Create team", exact: true }).last().click();
  await expect(page.getByText("Your team", { exact: true }).first()).toBeVisible();
  const alpha = (await api("GET", "/api/teams")).find((t: any) => t.name === `Alpha ${suffix}`);
  teamIds.push(alpha.id);
  assert.equal((await api("GET", "/api/auth/me")).teamId, alpha.id);
  assert.equal((await api("GET", `/api/projects/${p.id}`)).teamId, alpha.id);
  const conflict = await context.request.post("/api/teams", { data: { name: `Conflict ${suffix}`, projectIds: [p.id, p2.id] } });
  assert.equal(conflict.status(), 409);
  assert.match((await conflict.json()).message, /claimed/);
  assert.equal((await api("GET", "/api/auth/me")).teamId, alpha.id);
  assert.equal((await api("GET", `/api/projects/${p2.id}`)).teamId, null);
  console.log("Wizard cancellation, transactional claim, and membership verified");
  const beta = await api("POST", "/api/teams", { name: `Beta ${suffix}`, projectIds: [] });
  teamIds.push(beta.id);
  await page.reload();
  const alphaRow = page.locator("div.flex.flex-wrap").filter({ has: page.getByText(alpha.name, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Join team" }) }).last();
  await alphaRow.getByRole("button", { name: "Join team" }).click();
  await expect.poll(async () => (await api("GET", "/api/auth/me")).teamId).toBe(alpha.id);
  await page.getByRole("link", { name: new RegExp(p.name) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}$`));
  await expect(page.getByRole("heading", { name: "Original overview" })).toBeVisible();
  const milestonePanel = page.locator("aside");
  await milestonePanel.getByRole("button", { name: "Add", exact: true }).click();
  await milestonePanel.getByPlaceholder("Milestone name").fill(`Browser milestone ${suffix}`);
  await milestonePanel.getByPlaceholder("Timeline (optional)").fill("Week 2");
  await milestonePanel.locator("button.bg-primary").click();
  await expect(milestonePanel.getByText(`Browser milestone ${suffix}`, { exact: true })).toBeVisible();
  const milestoneRow = milestonePanel.locator("div.group").filter({ has: page.getByText(`Browser milestone ${suffix}`, { exact: true }) });
  await milestoneRow.getByTitle("Rename milestone").click();
  await milestonePanel.locator("input").first().fill(`Renamed milestone ${suffix}`);
  await milestonePanel.getByPlaceholder("Timeline").fill("Week 3");
  await milestonePanel.locator("button.text-green-600").click();
  await expect(milestonePanel.getByText(`Renamed milestone ${suffix}`, { exact: true })).toBeVisible();
  assert.ok((await api("GET", `/api/projects/${p.id}/milestones`)).some((m: any) => m.name === `Renamed milestone ${suffix}` && m.timeline === "Week 3"));
  page.once("dialog", dialog => dialog.accept());
  await milestonePanel.locator("div.group").filter({ has: page.getByText(`Renamed milestone ${suffix}`, { exact: true }) }).getByTitle("Remove milestone").click();
  await expect(milestonePanel.getByText(`Renamed milestone ${suffix}`, { exact: true })).toHaveCount(0);
  console.log("Milestone creation, timeline editing, and deletion verified");
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByPlaceholder("Describe the project in Markdown…").fill("# Canceled overview");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Original overview" })).toBeVisible();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByPlaceholder("Describe the project in Markdown…").fill("# Saved overview\n\n**Kept text**");
  await expect(page.getByRole("heading", { name: "Saved overview" })).toBeVisible();
  console.log("Markdown preview/save/cancel and refresh verified");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Saved overview" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(own.title) }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${own.id}\\?from=project:${p.id}`));
  await page.getByRole("button", { name: "Back to Project", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${p.id}$`));
  await page.goto(`/tasks/${own.id}?from=project:${p.id}`);
  await page.getByTestId("input-task-page-title").fill(`${own.title} edited`);
  await page.getByTestId("button-save-task-page").click();
  await expect.poll(async () => (await api("GET", `/api/tasks/${own.id}`)).title).toBe(`${own.title} edited`);
  own.title = `${own.title} edited`;
  await page.getByTestId("button-close-task-page").click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByTestId("select-task-project")).toContainText(p.name);
  await page.getByTestId("input-task-title").fill(`Created in project ${suffix}`);
  await page.getByTestId("select-task-milestone").click();
  await page.getByRole("option", { name: "First milestone", exact: true }).click();
  await page.getByTestId("button-submit-task").click();
  await expect(page.getByTestId("dialog-task-form")).toHaveCount(0);
  const created = (await api("GET", "/api/tasks")).find((t: any) => t.title === `Created in project ${suffix}`);
  taskIds.push(created.id);
  assert.equal(created.projectId, p.id);
  console.log("Project task creation and return navigation verified");
  await page.goto("/tasks");
  await expect(page.getByTestId("select-team-scope")).toContainText("My team");
  await expect(page.getByText(own.title, { exact: true })).toBeVisible();
  await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(loose.title, { exact: true })).toHaveCount(0);
  await choose("select-project-filter", p.name);
  await choose("select-team-scope", beta.name);
  await expect(page.getByTestId("select-project-filter")).toContainText("All projects");
  await choose("select-team-scope", "Unassigned");
  await expect(page.getByText(loose.title, { exact: true })).toBeVisible();
  await expect(page.getByText(other.title, { exact: true })).toBeVisible();
  await expect(page.getByText(own.title, { exact: true })).toHaveCount(0);
  await choose("select-team-scope", "All teams");
  await page.getByTestId("input-task-search").fill(own.title);
  await expect(page.getByTestId(`text-task-title-${own.id}`)).toBeVisible();
  await expect(page.getByText(other.title, { exact: true })).toHaveCount(0);
  await page.getByTestId("input-task-search").fill("");
  await choose("select-sprint-filter", "Backlog");
  await expect(page.getByText(own.title, { exact: true })).toHaveCount(0);
  await choose("select-sprint-filter", "All sprints");
  // Exercise the real HTML5 drag/drop handlers. Headless Chromium's mouse
  // dragTo does not reliably deliver native drop events in this environment.
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await page.getByTestId(`card-task-${own.id}`).dispatchEvent("dragstart", { dataTransfer: transfer });
  assert.equal(await transfer.evaluate(value => value.getData("taskId")), String(own.id));
  await page.getByTestId("column-in_progress").dispatchEvent("dragover", { dataTransfer: transfer });
  await page.getByTestId("column-in_progress").dispatchEvent("drop", { dataTransfer: transfer });
  await page.getByTestId(`card-task-${own.id}`).dispatchEvent("dragend", { dataTransfer: transfer });
  await transfer.dispose();
  await expect.poll(async () => (await api("GET", `/api/tasks/${own.id}`)).status).toBe("in_progress");
  await api("POST", `/api/tasks/${own.id}/archive`);
  await page.reload();
  await choose("select-team-scope", "All teams");
  await choose("select-sprint-filter", "All sprints");
  await page.getByTestId("button-view-archived").click();
  await expect(page.getByText(own.title, { exact: true })).toBeVisible();
  await page.getByTestId(`card-archived-task-${own.id}`).getByRole("button", { name: "Restore" }).click();
  await expect.poll(async () => (await api("GET", `/api/tasks/${own.id}`)).isArchived).toBe(false);
  console.log("Board default/combined scopes, drag-and-drop, archive/restore verified");
  await page.goto(`/projects/${p.id}`);
  await selectLabel("Project team", beta.name);
  await expect.poll(async () => (await api("GET", `/api/projects/${p.id}`)).teamId).toBe(beta.id);
  await page.goto("/tasks");
  await expect(page.getByText(own.title, { exact: true })).toHaveCount(0);
  await choose("select-team-scope", beta.name);
  await expect(page.getByText(own.title, { exact: true })).toBeVisible();
  await page.goto(`/projects/${p.id}`);
  await selectLabel("Project team", "Unassigned");
  assert.equal((await api("GET", `/api/projects/${p.id}`)).teamId, null);
  await page.goto("/team-overview");
  await page.getByRole("button", { name: "Leave team", exact: true }).click();
  await expect.poll(async () => (await api("GET", "/api/auth/me")).teamId).toBe(null);
  await page.goto("/tasks");
  await expect(page.getByTestId("select-team-scope")).toContainText("All teams");
  console.log("Project reassignment/clearing and nonmember defaults verified");
  // Shared sprint creation/confirmation and reset to original, without moving tasks.
  await page.goto("/team-overview");
  const nextResponse = page.waitForResponse(response => response.url().endsWith("/api/sprints/next") && response.request().method() === "POST");
  await page.getByRole("button", { name: /^Add Sprint / }).click();
  const next = await (await nextResponse).json();
  nextSprintId = next.id;
  page.once("dialog", dialog => dialog.dismiss());
  await selectLabel("Current sprint", `Sprint ${next.number}`);
  assert.equal((await api("GET", "/api/sprint-settings")).currentSprintId, oldSprintId);
  page.once("dialog", dialog => dialog.accept());
  await selectLabel("Current sprint", `Sprint ${next.number}`);
  await expect.poll(async () => (await api("GET", "/api/sprint-settings")).currentSprintId).toBe(next.id);
  await api("PATCH", "/api/sprint-settings/current", { sprintId: oldSprintId });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "overview should fit narrow screen");
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/team-overview-mobile.png", fullPage: true });
  await page.goto(`/projects/${p.id}`);
  await expect(page.getByRole("heading", { name: "Saved overview" })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "project should fit narrow screen");
  await page.screenshot({ path: "screenshots/project-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  if (process.env.TEAM_TEST_RESTART === "1") {
    await writeFile("/tmp/team-browser-ready", "ready");
    console.log("READY_FOR_RESTART");
    while (!existsSync("/tmp/team-browser-resume")) await new Promise(resolve => setTimeout(resolve, 500));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Saved overview" })).toBeVisible();
    assert.equal((await api("GET", "/api/auth/me")).id, userId);
    assert.ok((await api("GET", "/api/teams")).some((t: any) => t.id === alpha.id));
  }
  console.log("Teams/workspaces browser verification passed");
} catch (error) {
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/team-browser-failure.png" }).catch(() => {});
  console.error("Failure on", page.url());
  throw error;
} finally {
  if (oldSprintId != null) await context.request.patch("/api/sprint-settings/current", { data: { sprintId: oldSprintId } });
  if (taskIds.length) {
    await pool.query("DELETE FROM task_assignees WHERE task_id = ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::int[])", [taskIds]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM milestones WHERE project_id = ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id = ANY($1::int[])", [projectIds]);
  }
  if (userId) {
    await pool.query("DELETE FROM session WHERE sess->'passport'->>'user' = $1", [String(userId)]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  if (teamIds.length) await pool.query("DELETE FROM teams WHERE id = ANY($1::int[])", [teamIds]);
  if (nextSprintId) await pool.query("DELETE FROM sprints WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM tasks WHERE sprint_id = $1)", [nextSprintId]);
  await browser.close();
  await pool.end();
}