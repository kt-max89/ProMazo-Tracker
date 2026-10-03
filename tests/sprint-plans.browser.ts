// Real authenticated preview with disposable records. Only current-sprint GET
// responses are overridden to avoid changing the shared tracker's settings.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Run only in development preview");
const suffix = randomUUID().slice(0, 8);
const email = `plan-${suffix}@example.test`, password = randomUUID();
const browser = await chromium.launch({ executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined, args: ["--no-sandbox"] });
const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
let userId: number | undefined;
const projectIds: number[] = [], sprintIds: number[] = [], taskIds: number[] = [];
let currentSprintId: number | null = null;
let settingsFailure = false;
async function api(method: string, path: string, data?: unknown) {
  const response = await context.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
function section() { return page.locator('section[aria-labelledby="sprint-plan-title"]'); }
const draft = () => page.getByRole("textbox", { name: "Sprint plan Markdown" });
const template = (number: number) => `## Sprint ${number}
### Sprint Overview
Write a brief paragraph about where we are and how things feel

### Sprint goals (tactical)
1. These should map to milestones. Not specific tasks.

### Sprint Adaptive goals
1. List them here

### Sprint tasks
1. Create a list of tasks, broken down as small as possible
2. Here, we can just describe them all
3. Copy this entire plan and give it to the chat to create the tasks in bulk

### Uncertainty
* What things could get in our way?
* What things are you worried about?
* What are other impacts to the team in this sprint?`;
async function fits() {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${page.viewportSize()?.width}`);
}
try {
  userId = (await pool.query("INSERT INTO users(email,password_hash,display_name,role) VALUES ($1,$2,$3,'user') RETURNING id", [email, await bcrypt.hash(password, 4), `Plan tester ${suffix}`])).rows[0].id;
  // Large unique displayed numbers keep fixture sprints separate from real ones.
  const sprintNumber = 100000 + Math.floor(Math.random() * 100000000);
  for (let i = 0; i < 12; i++) sprintIds.push((await pool.query("INSERT INTO sprints(number) VALUES ($1) RETURNING id", [sprintNumber + i])).rows[0].id);
  currentSprintId = sprintIds[0];
  await page.route("**/api/sprint-settings", route => route.fulfill({
    status: settingsFailure ? 503 : 200, contentType: "application/json",
    body: JSON.stringify(settingsFailure ? { message: "Injected settings failure" } : { currentSprintId }),
  }));
  const signedOut = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
  for (const [method, path, data] of [
    ["GET", "/api/projects/1/sprint-plans", undefined],
    ["POST", "/api/projects/1/sprint-plans", { sprintId: sprintIds[0], content: "Unauthorized" }],
    ["PATCH", "/api/projects/1/sprint-plans/1", { content: "Unauthorized" }],
  ] as const) assert.equal((await signedOut.request.fetch(path, { method, data })).status(), 401);
  await signedOut.close();
  await page.goto("/auth");
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  const longName = `Deliver the complete cross-functional onboarding milestone with accessibility validation and release readiness ${"unbroken".repeat(16)}`;
  const project = await api("POST", "/api/projects", {
    name: `Sprint plans ${suffix}`, description: "## Original overview\n\n- Keep overview untouched",
    milestones: [{ name: longName, excludedSprintIds: [] }],
  });
  projectIds.push(project.id);
  const other = await api("POST", "/api/projects", { name: `Other plan project ${suffix}` });
  projectIds.push(other.id);
  const root = `/api/projects/${project.id}/sprint-plans`;
  const milestone = (await api("GET", `/api/projects/${project.id}/milestones`))[0];
  const task = await api("POST", "/api/tasks", { title: `Plan task ${suffix}`, projectId: project.id, milestoneId: milestone.id, sprintId: sprintIds[0] });
  taskIds.push(task.id);
  await page.goto(`/projects/${project.id}`);
  await expect(section().getByText(`No plan has been saved for Sprint ${sprintNumber}.`, { exact: false })).toBeVisible();
  assert.deepEqual(await api("GET", root), []);
  await section().getByRole("button", { name: "View all sprint plans" }).click();
  await expect(page.getByText("No saved plans for this project yet.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await section().getByRole("button", { name: "Create sprint plan", exact: true }).click();
  await expect(draft()).toHaveValue(template(sprintNumber));
  await section().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.deepEqual(await api("GET", root), []);
  await section().getByRole("button", { name: "Create sprint plan", exact: true }).click();
  const markdown = `## Sprint ${sprintNumber}\n### Saved overview\nFirst line  \nSecond line\n\n1. **Tactical goal**\n2. [Reference](https://example.com)\n\n${"VeryLongContent".repeat(120)}\n\n<script>window.unsafePlan=true</script>`;
  await draft().fill(markdown);
  // Explicit failed create retains the draft and supports retry.
  await page.route(`**${root}`, async route => {
    if (route.request().method() === "POST") await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Injected save failure"}' });
    else await route.continue();
  });
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(section().getByRole("alert")).toContainText("Your draft is preserved");
  await expect(draft()).toHaveValue(markdown);
  assert.deepEqual(await api("GET", root), []);
  await page.unroute(`**${root}`);
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(draft()).toHaveCount(0);
  const saved = (await api("GET", root))[0];
  assert.equal(saved.content, markdown);
  assert.equal(saved.sprintId, sprintIds[0]);
  await expect(section().getByRole("heading", { name: "Saved overview" })).toBeVisible();
  await expect(section().getByRole("link", { name: "Reference" })).toHaveAttribute("href", "https://example.com");
  assert.equal(await page.evaluate(() => (window as any).unsafePlan), undefined);
  assert.equal(await section().locator("script").count(), 0);
  await page.reload();
  await expect(section().getByRole("heading", { name: "Saved overview" })).toBeVisible();
  // Historical creation while the current sprint already has a plan.
  await section().getByRole("button", { name: "View all sprint plans" }).click();
  await page.getByRole("combobox", { name: "Choose sprint for new plan" }).click();
  await page.getByRole("option", { name: `Sprint ${sprintNumber + 1}`, exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(draft()).toHaveValue(template(sprintNumber + 1));
  await draft().fill("## Historical saved\n\n- Old goals");
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(draft()).toHaveCount(0);
  let plans = await api("GET", root);
  assert.equal(plans.length, 2);
  assert.equal(plans.find((p: any) => p.sprintId === sprintIds[0]).content, markdown);
  await section().getByRole("button", { name: "Edit plan", exact: true }).click();
  await draft().fill("## Historical edited\n\n- New goals");
  await section().getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(section().getByRole("heading", { name: "Historical saved" })).toBeVisible();
  await section().getByRole("button", { name: "Edit plan", exact: true }).click();
  await draft().fill("## Historical edited\n\n- New goals");
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(section().getByRole("heading", { name: "Historical edited" })).toBeVisible();
  await section().getByRole("button", { name: "Return to current plan" }).click();
  await expect(section().getByRole("heading", { name: "Saved overview" })).toBeVisible();
  await section().getByRole("button", { name: "View all sprint plans" }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`Sprint ${sprintNumber + 1} · Historical`) }).click();
  await expect(section().getByRole("heading", { name: "Historical edited" })).toBeVisible();
  await section().getByRole("button", { name: "Return to current plan" }).click();
  // Existing pair opens its saved plan, never a replacement draft.
  await section().getByRole("button", { name: "View all sprint plans" }).click();
  await page.getByRole("combobox", { name: "Choose sprint for new plan" }).click();
  await page.getByRole("option", { name: `Sprint ${sprintNumber} · Current`, exact: true }).click();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(draft()).toHaveCount(0);
  assert.equal((await api("GET", root)).length, 2);
  // Edit remains assigned to the original sprint through current changes.
  await section().getByRole("button", { name: "Edit plan", exact: true }).click();
  await draft().fill("## Preserved current edit");
  await page.route(`**${root}/${saved.id}`, async route => {
    if (route.request().method() === "PATCH") await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Injected edit failure"}' });
    else await route.continue();
  });
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(section().getByRole("alert")).toContainText("Injected edit failure");
  await expect(draft()).toHaveValue("## Preserved current edit");
  assert.equal((await api("GET", `${root}/${saved.id}`)).content, markdown);
  await page.unroute(`**${root}/${saved.id}`);
  currentSprintId = sprintIds[1];
  await expect(section().getByText(`Tracker current sprint · Sprint ${sprintNumber + 1}`, { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(draft()).toHaveValue("## Preserved current edit");
  await expect(section().getByText("Historical · no longer current", { exact: true })).toBeVisible();
  settingsFailure = true;
  await expect(section().getByText(/Some sprint information could not be refreshed/)).toBeVisible({ timeout: 12000 });
  await expect(draft()).toHaveValue("## Preserved current edit");
  settingsFailure = false;
  // Declining task navigation and browser back keeps the exact draft.
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: new RegExp(task.title) }).click();
  await expect(draft()).toHaveValue("## Preserved current edit");
  page.once("dialog", dialog => dialog.dismiss());
  // A deliberately cancelled navigation never reaches Playwright's load event.
  await page.evaluate(() => window.history.back());
  await expect(draft()).toHaveValue("## Preserved current edit");
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(draft()).toHaveCount(0);
  plans = await api("GET", root);
  assert.equal(plans.find((p: any) => p.sprintId === sprintIds[0]).content, "## Preserved current edit");
  assert.equal(plans.find((p: any) => p.sprintId === sprintIds[1]).content, "## Historical edited\n\n- New goals");
  await section().getByRole("button", { name: "Return to current plan" }).click();
  await expect(section().getByRole("heading", { name: "Historical edited" })).toBeVisible();
  currentSprintId = sprintIds[2];
  await expect(section().getByText(`No plan has been saved for Sprint ${sprintNumber + 2}.`, { exact: false })).toBeVisible({ timeout: 12000 });
  assert.equal((await api("GET", root)).length, 2);
  // Concurrent duplicate created after the browser's list was loaded.
  await section().getByRole("button", { name: "Create sprint plan", exact: true }).click();
  await draft().fill("My duplicate draft");
  const concurrent = await api("POST", root, { sprintId: sprintIds[2], content: "## Concurrent saved plan" });
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(draft()).toHaveValue("My duplicate draft");
  page.once("dialog", dialog => dialog.dismiss());
  await section().getByRole("button", { name: `Open saved Sprint ${sprintNumber + 2} plan` }).click();
  await expect(draft()).toHaveValue("My duplicate draft");
  page.once("dialog", dialog => dialog.accept());
  await section().getByRole("button", { name: `Open saved Sprint ${sprintNumber + 2} plan` }).click();
  await expect(section().getByRole("heading", { name: "Concurrent saved plan" })).toBeVisible();
  assert.equal((await api("GET", `${root}/${concurrent.id}`)).content, "## Concurrent saved plan");
  // Force the authoritative POST conflict (not only the preflight duplicate).
  currentSprintId = sprintIds[3];
  await expect(section().getByText(`No plan has been saved for Sprint ${sprintNumber + 3}.`, { exact: false })).toBeVisible({ timeout: 12000 });
  await section().getByRole("button", { name: "Create sprint plan", exact: true }).click();
  await page.route(`**${root}`, async route => {
    if (route.request().method() === "POST") {
      await api("POST", root, { sprintId: sprintIds[3], content: "## POST race winner" });
    }
    await route.continue();
  });
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(section().getByRole("alert")).toContainText("already exists");
  await expect(draft()).toHaveValue(template(sprintNumber + 3));
  await page.unroute(`**${root}`);
  page.once("dialog", dialog => dialog.accept());
  await section().getByRole("button", { name: `Open saved Sprint ${sprintNumber + 3} plan` }).click();
  await expect(section().getByRole("heading", { name: "POST race winner" })).toBeVisible();
  // A new draft also retains its assigned sprint when the tracker changes.
  currentSprintId = sprintIds[4];
  await expect(section().getByText(`No plan has been saved for Sprint ${sprintNumber + 4}.`, { exact: false })).toBeVisible({ timeout: 12000 });
  await section().getByRole("button", { name: "Create sprint plan", exact: true }).click();
  await expect(draft()).toHaveValue(template(sprintNumber + 4));
  currentSprintId = sprintIds[5];
  await expect(section().getByText(`Tracker current sprint · Sprint ${sprintNumber + 5}`, { exact: true })).toBeVisible({ timeout: 12000 });
  await expect(draft()).toHaveValue(template(sprintNumber + 4));
  await draft().fill(markdown);
  await section().getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(draft()).toHaveCount(0);
  assert.equal((await api("GET", root)).find((p: any) => p.sprintId === sprintIds[4]).content, markdown);
  assert.equal((await api("GET", root)).some((p: any) => p.sprintId === sprintIds[5]), false);
  // Realistic long milestone name + many badges across responsive widths.
  await mkdir("screenshots", { recursive: true });
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(section().getByRole("heading", { name: "Saved overview" })).toBeVisible();
    const name = page.getByText(longName, { exact: true });
    await expect(name).toBeVisible();
    const dimensions = await name.evaluate(element => ({ width: element.clientWidth, height: element.clientHeight, scroll: element.scrollWidth, overflow: getComputedStyle(element).textOverflow }));
    assert.ok(dimensions.width > 180 && dimensions.scroll <= dimensions.width + 1, JSON.stringify(dimensions));
    assert.notEqual(dimensions.overflow, "ellipsis");
    await fits();
    await page.getByRole("button", { name: `Edit ${longName}`, exact: true }).click();
    await expect(page.getByRole("button", { name: "Save milestone changes" })).toBeVisible();
    await fits();
    await page.getByRole("button", { name: "Cancel milestone editing" }).click();
    await page.screenshot({ path: `screenshots/sprint-plans-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await fits();
  await expect(section().getByRole("link", { name: "Reference" })).toBeVisible();
  await page.screenshot({ path: "screenshots/sprint-plans-dark-phone.png", fullPage: true });
  assert.equal((await api("GET", `/api/projects/${project.id}`)).description, project.description);
  assert.equal((await api("GET", `/api/tasks/${task.id}`)).sprintId, sprintIds[0]);
  assert.deepEqual((await api("GET", `/api/projects/${project.id}/milestones`))[0].excludedSprintIds, []);
  // Create/edit/delete controls retain exclusion defaults and task references.
  await page.getByRole("button", { name: `Edit ${longName}`, exact: true }).click();
  await page.getByRole("checkbox", { name: `Include Sprint ${sprintNumber}`, exact: true }).uncheck();
  await page.getByRole("button", { name: "Save milestone changes" }).click();
  await expect(page.getByRole("button", { name: "Save milestone changes" })).toHaveCount(0);
  assert.deepEqual((await api("GET", `/api/projects/${project.id}/milestones`))[0].excludedSprintIds, [sprintIds[0]]);
  assert.equal((await api("GET", `/api/tasks/${task.id}`)).milestoneId, milestone.id);
  await page.getByRole("button", { name: "Add milestone", exact: true }).click();
  await page.getByPlaceholder("Milestone name").fill("Disposable milestone");
  await page.getByRole("button", { name: "Save new milestone" }).click();
  await expect(page.getByText("Disposable milestone", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByRole("button", { name: "Remove Disposable milestone", exact: true }).click();
  await expect(page.getByText("Disposable milestone", { exact: true })).toBeVisible();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "Remove Disposable milestone", exact: true }).click();
  await expect(page.getByText("Disposable milestone", { exact: true })).toHaveCount(0);
  await page.goto("/projects");
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    // Projects list uses a mount-time desktop sidebar state.
    await page.reload();
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "All sprints", exact: true }).click();
    const closeSidebar = page.getByRole("button", { name: "Close sidebar", exact: true });
    if (await closeSidebar.isVisible()) await closeSidebar.click();
    await expect(page.getByText(longName, { exact: true })).toBeVisible();
    const bounds = await page.getByText(longName, { exact: true }).evaluate(e => ({ width: e.clientWidth, scroll: e.scrollWidth }));
    assert.ok(bounds.width > 150 && bounds.scroll <= bounds.width + 1);
    await expect(page.getByRole("button", { name: `Edit ${longName}`, exact: true })).toBeAttached();
  }
  // Other project, no-current, explicit plan/settings/sprint errors.
  currentSprintId = null;
  await page.goto(`/projects/${other.id}`);
  await expect(section().getByText(/There is no current sprint/)).toBeVisible({ timeout: 12000 });
  assert.deepEqual(await api("GET", `/api/projects/${other.id}/sprint-plans`), []);
  await section().getByRole("button", { name: "View all sprint plans" }).click();
  await expect(page.getByText("No saved plans for this project yet.")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.route(`**/api/projects/${other.id}/sprint-plans`, route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Injected load failure"}' }));
  await page.reload();
  await expect(section().getByText(/Sprint plan information couldn’t be loaded/)).toBeVisible();
  await page.unroute(`**/api/projects/${other.id}/sprint-plans`);
  await section().getByRole("button", { name: "Try again", exact: true }).click();
  await expect(section().getByText(/There is no current sprint/)).toBeVisible();
  let releaseLoad!: () => void;
  const loadingGate = new Promise<void>(resolve => { releaseLoad = resolve; });
  await page.route(`**/api/projects/${other.id}/sprint-plans`, async route => { await loadingGate; await route.continue(); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(section().getByRole("status")).toBeVisible();
  releaseLoad();
  await page.unroute(`**/api/projects/${other.id}/sprint-plans`, { behavior: "wait" });
  await expect(section().getByText(/There is no current sprint/)).toBeVisible();
  currentSprintId = 2147483647;
  await expect(section().getByText(/Tracker settings point to sprint ID/)).toBeVisible({ timeout: 12000 });
  await page.route("**/api/sprints", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Injected sprint failure"}' }));
  await page.reload();
  await expect(section().getByText(/Sprint plan information couldn’t be loaded/)).toBeVisible();
  await page.unroute("**/api/sprints");
  await page.goto("/projects/invalid");
  await expect(page.getByRole("heading", { name: "Project unavailable" })).toBeVisible();
  assert.deepEqual(errors, []);
  console.log("Signed-in sprint-plan lifecycle, assignment, drafts, failures, navigation and responsive milestone checks passed.");
} finally {
  await context.close();
  await browser.close();
  for (const id of taskIds) {
    await pool.query("DELETE FROM task_activity WHERE task_id=$1", [id]);
    await pool.query("DELETE FROM task_comments WHERE task_id=$1", [id]);
    await pool.query("DELETE FROM task_assignees WHERE task_id=$1", [id]);
    await pool.query("DELETE FROM tasks WHERE id=$1", [id]);
  }
  for (const id of projectIds) {
    await pool.query("DELETE FROM milestones WHERE project_id=$1", [id]);
    await pool.query("DELETE FROM projects WHERE id=$1", [id]);
  }
  if (userId) {
    await pool.query("DELETE FROM session WHERE sess->'passport'->>'user'=$1 OR sess->'passport'->'user'->>'id'=$1", [String(userId)]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  for (const id of sprintIds) await pool.query("DELETE FROM sprints WHERE id=$1", [id]);
  await pool.end();
}