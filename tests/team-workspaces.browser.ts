// Development-only signed-in browser/API regression using disposable records.
// No registration credentials, admin changes, auth bypass, or production writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";
import { verifyTeamUpdateComposer } from "./team-update-composer.browser";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Run only in development preview");
const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID().slice(0, 8);
const email = `workspace-${suffix}@example.test`, password = `Disposable-${randomUUID()}`;
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const projectIds: number[] = [], taskIds: number[] = [], teamIds: number[] = [], sprintIds: number[] = [];
let userId: number | undefined;
async function api(method: string, path: string, data?: unknown) {
  const response = await context.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function choose(testId: string, option: string) {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
function contractSection() {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Social contract", exact: true }) }).last();
}
async function phoneFits() {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 1, `Unexpected mobile overflow ${overflow}px at ${page.url()}`);
}
try {
  userId = (await pool.query<{ id: number }>(
    "INSERT INTO users(email,password_hash,display_name,role) VALUES ($1,$2,$3,'user') RETURNING id",
    [email, await bcrypt.hash(password, 4), `Workspace tester ${suffix}`],
  )).rows[0].id;
  const unauth = await browser.newContext({ baseURL });
  for (const [method, path, data] of [
    ["GET", "/api/teams/1", undefined],
    ["PATCH", "/api/teams/1", { socialContract: "Unauthorized" }],
    ["PUT", "/api/teams/1/projects/1", undefined],
    ["DELETE", "/api/teams/1/projects/1", undefined],
  ] as const) {
    assert.equal((await unauth.request.fetch(path, { method, data })).status(), 401);
  }
  const signedOutPage = await unauth.newPage();
  await signedOutPage.goto("/teams/1");
  await expect(signedOutPage.getByTestId("auth-page")).toBeVisible();
  await unauth.close();
  await page.goto("/auth");
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  assert.equal((await api("GET", "/api/auth/me")).role, "user");
  await verifyTeamUpdateComposer(page, suffix);
  if (!process.argv.includes("--composer-only")) {
  assert.equal((await context.request.get("/api/admin/users")).status(), 403);
  assert.equal((await context.request.post("/api/documents", { data: {} })).status(), 403);
  await api("GET", "/api/documents");
  const p = await api("POST", "/api/projects", {
    name: `Shared project ${suffix}`, description: "## Original overview\n\nPreserve **all** text.",
    timeline: "Q4", milestones: [{ name: "First milestone", timeline: "Historical week" }],
  });
  projectIds.push(p.id);
  const milestone = (await api("GET", `/api/projects/${p.id}/milestones`))[0];
  const originalSprints = await api("GET", "/api/sprints");
  const firstSprint = originalSprints[0];
  assert.ok(firstSprint, "At least the initial sprint exists");
  assert.deepEqual(milestone.excludedSprintIds, []);
  assert.equal(milestone.sprintIds.length, originalSprints.length);
  const alpha = await api("POST", "/api/teams", { name: `Alpha ${suffix}`, projectIds: [p.id,p.id] });
  teamIds.push(alpha.id);
  // Exercise creation wizard cancellation and linking an already assigned project.
  await page.goto("/team-overview");
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByPlaceholder("e.g. Platform delivery").fill(`Canceled ${suffix}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok(!(await api("GET", "/api/teams")).some((t: any) => t.name === `Canceled ${suffix}`));
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByPlaceholder("e.g. Platform delivery").fill(`Beta ${suffix}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("checkbox", { name: p.name, exact: true }).check();
  await page.getByRole("button", { name: "Create team", exact: true }).last().click();
  const beta = await expect.poll(async () => (await api("GET", "/api/teams")).some((t: any) => t.name === `Beta ${suffix}`)).toBe(true)
    .then(async () => (await api("GET", "/api/teams")).find((t: any) => t.name === `Beta ${suffix}`));
  teamIds.push(beta.id);
  assert.deepEqual((await api("GET", `/api/projects/${p.id}`)).teamIds, [alpha.id,beta.id]);
  await api("PATCH", "/api/teams/membership", { teamId: alpha.id });
  const statuses = ["not_started","in_progress","needs_review","done"];
  const labels = ["Not started","In progress","Needs review","Done"];
  for (const status of statuses) {
    const task = await api("POST", "/api/tasks", { title: `${status} ${suffix}`, status, projectId: p.id, milestoneId: milestone.id });
    taskIds.push(task.id);
  }
  const tasksBefore = await Promise.all(taskIds.map(id => api("GET", `/api/tasks/${id}`)));
  await page.goto(`/projects/${p.id}`);
  const colors: string[] = [];
  for (let i = 0; i < statuses.length; i++) {
    const row = page.getByRole("button", { name: new RegExp(`${statuses[i]} ${suffix}`) });
    const badge = row.getByText(labels[i], { exact: true });
    await expect(badge).toBeVisible();
    colors.push(await badge.evaluate(el => `${getComputedStyle(el).color}/${getComputedStyle(el).backgroundColor}`));
  }
  assert.equal(new Set(colors).size, 4, "All four status badges have distinct colors");
  await expect(page.getByText(alpha.name, { exact: true })).toBeVisible();
  await expect(page.getByText(beta.name, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByRole("checkbox", { name: beta.name, exact: true }).uncheck();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await api("GET", `/api/projects/${p.id}`)).teamIds.length, 2);
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByRole("checkbox", { name: beta.name, exact: true }).uncheck();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await api("GET", `/api/projects/${p.id}`)).teamIds).toEqual([alpha.id]);
  const panel = page.locator("aside");
  await panel.getByTitle("Rename milestone").click();
  await panel.getByRole("checkbox", { name: `Include Sprint ${firstSprint.number}`, exact: true }).uncheck();
  await panel.getByRole("button", { name: "Save milestone changes", exact: true }).click();
  await expect.poll(async () => (await api("GET", `/api/projects/${p.id}/milestones`))[0].excludedSprintIds).toEqual([firstSprint.id]);
  if (originalSprints.length === 1) await expect(panel.getByText("No sprints selected")).toBeVisible();
  assert.equal((await api("GET", `/api/projects/${p.id}/milestones`))[0].timeline, "Historical week");
  const next = await api("POST", "/api/sprints/next");
  sprintIds.push(next.id);
  await page.reload();
  await expect(panel.getByText(`Sprint ${next.number}`, { exact: true })).toBeVisible();
  await panel.getByTitle("Rename milestone").click();
  await expect(panel.getByRole("checkbox", { name: `Include Sprint ${firstSprint.number}`, exact: true })).not.toBeChecked();
  await expect(panel.getByRole("checkbox", { name: `Include Sprint ${next.number}`, exact: true })).toBeChecked();
  await panel.getByRole("button", { name: "Cancel milestone editing", exact: true }).click();
  await panel.getByRole("button", { name: "Add milestone", exact: true }).click();
  await panel.getByPlaceholder("Milestone name").fill(`New milestone ${suffix}`);
  await expect(panel.getByRole("checkbox", { name: `Include Sprint ${next.number}`, exact: true })).toBeChecked();
  await panel.getByRole("checkbox", { name: `Include Sprint ${firstSprint.number}`, exact: true }).uncheck();
  await panel.getByRole("button", { name: "Save new milestone", exact: true }).click();
  await expect(panel.getByText(`New milestone ${suffix}`, { exact: true })).toBeVisible();
  assert.deepEqual(await Promise.all(taskIds.map(id => api("GET", `/api/tasks/${id}`))), tasksBefore);
  // Team page direct/bookmarked access, member listing and independent links.
  await page.goto("/team-overview");
  await page.getByRole("link", { name: beta.name, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/teams/${beta.id}$`));
  await expect(page.getByRole("heading", { name: beta.name, exact: true })).toBeVisible();
  await expect(page.getByText("No members have joined this team yet.")).toBeVisible();
  await page.getByRole("button", { name: `Add ${p.name} to ${beta.name}`, exact: true }).click();
  await expect(page.getByRole("link", { name: p.name, exact: true })).toBeVisible();
  assert.deepEqual((await api("GET", `/api/projects/${p.id}`)).teamIds, [alpha.id,beta.id]);
  await page.route(`**/api/teams/${beta.id}/projects/${p.id}`, route => route.request().method() === "DELETE"
    ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Intentional link failure"}' }) : route.continue());
  await page.getByRole("button", { name: `Remove ${p.name} from ${beta.name}`, exact: true }).click();
  await expect(page.getByText("Intentional link failure", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: p.name, exact: true })).toBeVisible();
  assert.deepEqual((await api("GET", `/api/projects/${p.id}`)).teamIds, [alpha.id,beta.id]);
  await page.unroute(`**/api/teams/${beta.id}/projects/${p.id}`);
  await page.getByRole("button", { name: `Remove ${p.name} from ${beta.name}`, exact: true }).click();
  await expect(page.getByRole("link", { name: p.name, exact: true })).toHaveCount(0);
  assert.deepEqual((await api("GET", `/api/projects/${p.id}`)).teamIds, [alpha.id]);
  await page.getByRole("button", { name: `Add ${p.name} to ${beta.name}`, exact: true }).click();
  await expect(page.getByRole("link", { name: p.name, exact: true })).toBeVisible();
  await page.goto(`/teams/${alpha.id}`);
  await expect(page.getByText(`Workspace tester ${suffix}`, { exact: true })).toBeVisible();
  const contract = contractSection();
  await expect(contract.getByText(/No social contract yet/)).toBeVisible();
  await contract.getByRole("button", { name: "Edit contract" }).focus();
  await page.keyboard.press("Enter");
  await contract.getByRole("textbox", { name: "Social contract Markdown" }).fill("# Canceled");
  await contract.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal((await api("GET", `/api/teams/${alpha.id}`)).socialContract, "");
  const markdown = "# Agreement\nFirst line\nSecond line\n\n- **Respect**\n\n" + "longunbrokenword".repeat(200);
  await contract.getByRole("button", { name: "Edit contract" }).click();
  await contract.getByRole("textbox", { name: "Social contract Markdown" }).fill(markdown);
  await expect(contract.getByRole("heading", { name: "Agreement" })).toBeVisible();
  await page.route(`**/api/teams/${alpha.id}`, route => route.request().method() === "PATCH"
    ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Intentional test save failure"}' }) : route.continue());
  await contract.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Intentional test save failure", { exact: true })).toBeVisible();
  await expect(contract.getByRole("textbox", { name: "Social contract Markdown" })).toHaveValue(markdown);
  assert.equal((await api("GET", `/api/teams/${alpha.id}`)).socialContract, "");
  await page.unroute(`**/api/teams/${alpha.id}`);
  await contract.getByRole("button", { name: "Save", exact: true }).click();
  await expect(contract.getByRole("textbox")).toHaveCount(0);
  await page.reload();
  await expect(contract.getByRole("heading", { name: "Agreement" })).toBeVisible();
  await expect(contract.locator("strong")).toContainText("Respect");
  assert.equal((await api("GET", `/api/teams/${alpha.id}`)).socialContract, markdown);
  await page.setViewportSize({ width: 390, height: 844 });
  await phoneFits();
  await contract.getByRole("button", { name: "Edit contract" }).click();
  await phoneFits();
  await contract.getByRole("textbox", { name: "Social contract Markdown" }).fill("");
  await contract.getByRole("button", { name: "Save", exact: true }).click();
  await expect(contract.getByText(/No social contract yet/)).toBeVisible();
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/shared-team-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  // Project creation drafts and list editing use the same multi-team/exclusion model.
  await page.goto("/projects");
  await choose("select-sprint-filter", "All sprints");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("Project name").fill(`Draft project ${suffix}`);
  await dialog.getByRole("checkbox", { name: alpha.name, exact: true }).check();
  await dialog.getByRole("checkbox", { name: beta.name, exact: true }).check();
  await dialog.getByPlaceholder("Milestone name").fill("Draft milestone");
  await expect(dialog.getByRole("checkbox", { name: `Include Sprint ${next.number}`, exact: true })).toBeChecked();
  await dialog.getByRole("checkbox", { name: `Include Sprint ${firstSprint.number}`, exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  const projectResponse = page.waitForResponse(r => r.url().endsWith("/api/projects") && r.request().method() === "POST");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const drafted = await (await projectResponse).json();
  projectIds.push(drafted.id);
  await expect(dialog).toHaveCount(0);
  assert.deepEqual(drafted.teamIds, [alpha.id,beta.id]);
  assert.deepEqual((await api("GET", `/api/projects/${drafted.id}/milestones`))[0].excludedSprintIds, [firstSprint.id]);
  await page.getByTestId("input-project-search").fill(drafted.name);
  await page.getByTitle("Edit project").click();
  await dialog.getByRole("checkbox", { name: beta.name, exact: true }).uncheck();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  assert.deepEqual((await api("GET", `/api/projects/${drafted.id}`)).teamIds, [alpha.id]);
  await page.goto("/tasks");
  await choose("select-sprint-filter", "All sprints");
  await choose("select-team-scope", beta.name);
  for (const id of taskIds) await expect(page.getByTestId(`text-task-title-${id}`)).toBeVisible();
  await choose("select-project-filter", p.name);
  await choose("select-team-scope", alpha.name);
  await expect(page.getByTestId("select-project-filter")).toContainText(p.name);
  await choose("select-team-scope", "All teams");
  for (const id of taskIds) await expect(page.getByTestId(`text-task-title-${id}`)).toHaveCount(1);
  await api("DELETE", `/api/teams/${beta.id}/projects/${p.id}`);
  await page.reload();
  await choose("select-sprint-filter", "All sprints");
  await choose("select-team-scope", beta.name);
  for (const id of taskIds) await expect(page.getByTestId(`text-task-title-${id}`)).toHaveCount(0);
  assert.deepEqual(await Promise.all(taskIds.map(id => api("GET", `/api/tasks/${id}`))), tasksBefore);
  const invalidDraft = await context.request.post("/api/projects", { data: {
    name: `Invalid draft ${suffix}`, teamIds: [alpha.id], milestones: [{ name: "Invalid", excludedSprintIds: [99999999] }],
  } });
  assert.equal(invalidDraft.status(), 400);
  assert.ok(!(await api("GET", "/api/projects")).some((project: any) => project.name === `Invalid draft ${suffix}`));
  await page.route(`**/api/teams/${alpha.id}`, route => route.fulfill({
    status: 500, contentType: "application/json", body: '{"message":"Intentional load failure"}',
  }));
  await page.goto(`/teams/${alpha.id}`);
  await expect(page.getByRole("heading", { name: "Team unavailable" })).toBeVisible();
  await page.unroute(`**/api/teams/${alpha.id}`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("heading", { name: alpha.name, exact: true })).toBeVisible();
  await page.goto("/teams/99999999");
  await expect(page.getByRole("heading", { name: "Team not found" })).toBeVisible();
  assert.equal((await context.request.patch("/api/teams/99999999", { data: { socialContract: "missing" } })).status(), 404);
  assert.equal((await context.request.put(`/api/teams/${alpha.id}/projects/99999999`)).status(), 404);
  await page.goto(`/projects/${p.id}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await phoneFits();
  await expect(page.getByRole("heading", { name: "Original overview" })).toBeVisible();
  await page.screenshot({ path: "screenshots/shared-project-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Shared projects, sprint defaults/exclusions, four status colors, team pages, contracts save/cancel/error, auth boundaries and mobile layouts passed.");
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await mkdir("screenshots", { recursive: true });
  await page.screenshot({ path: "screenshots/shared-workspaces-failure.png" }).catch(() => {});
  console.error("Failure on", page.url());
  throw error;
} finally {
  if (taskIds.length) {
    await pool.query("DELETE FROM task_assignees WHERE task_id = ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::int[])", [taskIds]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM milestones WHERE project_id = ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id = ANY($1::int[])", [projectIds]);
  }
  if (userId) {
    await pool.query("DELETE FROM team_posts WHERE author_id = $1", [userId]);
    await pool.query("DELETE FROM session WHERE sess->'passport'->>'user' = $1", [String(userId)]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  if (teamIds.length) await pool.query("DELETE FROM teams WHERE id = ANY($1::int[])", [teamIds]);
  if (sprintIds.length) await pool.query("DELETE FROM sprints WHERE id = ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.sprint_id=sprints.id)", [sprintIds]);
  await browser.close();
  await pool.end();
}