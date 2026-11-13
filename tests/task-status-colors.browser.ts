// Development-only signed-in checks; only disposable fixtures are changed.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const suffix = randomUUID(), password = randomUUID();
const statuses = ["not_started", "in_progress", "needs_review", "done"];
const labels = ["Not started", "In progress", "Needs review", "Done"];
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
  viewport: { width: 1600, height: 1000 },
});
// tsx preserves nested function names via this helper when serializing evaluate callbacks.
await context.addInitScript("window.__name = (fn) => fn;");
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
let userId: number | undefined;
const taskIds: number[] = [];
mkdirSync("generated-artifacts/kanban", { recursive: true });

// Measure rendered text against its composited background, including translucent
// dark column backgrounds. This catches missing generated CSS as well as contrast.
async function styles(selector: string) {
  return page.locator(selector).evaluate(element => {
    function rgba(value: string): number[] {
      const parts = value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      return [...parts.slice(0, 3), parts[3] ?? 1];
    }
    let background = [255, 255, 255];
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    for (const ancestor of ancestors) {
      const color = rgba(getComputedStyle(ancestor).backgroundColor);
      background = background.map((channel, index) => color[index] * color[3] + channel * (1 - color[3]));
    }
    const computed = getComputedStyle(element);
    function luminance(rgb: number[]) {
      return rgb.slice(0, 3).map(channel => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    }
    const textL = luminance(rgba(computed.color)), bgL = luminance(background);
    return {
      color: computed.color, background: computed.backgroundColor, border: computed.borderColor,
      contrast: (Math.max(textL, bgL) + 0.05) / (Math.min(textL, bgL) + 0.05),
    };
  });
}

try {
  const hash = await bcrypt.hash(password, 4);
  userId = (await pool.query(
    "INSERT INTO users(email,password_hash,display_name,is_active) VALUES($1,$2,$3,true) RETURNING id",
    [`kanban-${suffix}@example.test`, hash, "Kanban test"],
  )).rows[0].id;
  assert.equal((await context.request.post("/api/auth/login", {
    data: { email: `kanban-${suffix}@example.test`, password },
  })).status(), 200);
  for (const status of statuses) {
    const created = await context.request.post("/api/tasks", { data: {
      title: `Kanban ${suffix} ${status}`, status, assigneeIds: [userId], sprintId: null,
    } });
    assert.equal(created.status(), 200);
    taskIds.push((await created.json()).id);
  }
  const reference = new Map<string, unknown>();
  for (const path of ["/tasks", "/my-tasks"]) {
    await page.goto(path);
    await page.getByTestId("select-sprint-filter").click();
    await page.getByRole("option", { name: "All sprints", exact: true }).click();
    await page.getByTestId("input-task-search").fill(`Kanban ${suffix}`);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { localStorage.setItem("theme", theme); }, theme);
      // Toggle through the UI to keep ThemeProvider and the root class in sync.
      const isDark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
      if (isDark !== (theme === "dark")) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
      await page.waitForTimeout(400); // Let theme background/color transitions finish before contrast measurement.
      const expectedColors = theme === "light"
        ? ["rgb(71, 85, 105)", "rgb(29, 78, 216)", "rgb(21, 128, 61)", "rgb(126, 34, 206)"]
        : ["rgb(148, 163, 184)", "rgb(96, 165, 250)", "rgb(74, 222, 128)", "rgb(192, 132, 252)"];
      for (const [index, status] of statuses.entries()) {
        const column = page.getByTestId(`column-${status}`);
        await expect(column.getByText(labels[index], { exact: true })).toBeVisible();
        await expect(column.getByTestId(`card-task-${taskIds[index]}`)).toBeVisible();
        const selector = `[data-testid="column-${status}"] > div:first-child > span:first-of-type`;
        const header = await styles(selector);
        assert.equal(header.color, expectedColors[index]);
        assert.ok(header.contrast >= 4.5, `${path} ${theme} ${status}: contrast ${header.contrast}`);
        const icon = await column.locator("svg").first().evaluate(el => getComputedStyle(el).color);
        assert.equal(icon, header.color);
        const columnStyles = await styles(`[data-testid="column-${status}"]`);
        const key = `${theme}-${status}`;
        const rendered = { header: header.color, background: columnStyles.background, border: columnStyles.border };
        if (path === "/tasks") reference.set(key, rendered);
        else assert.deepEqual(rendered, reference.get(key));
      }
      await page.screenshot({ path: `generated-artifacts/kanban/${path.slice(1)}-${theme}.png` });
    }
    // Explicit DataTransfer events test the existing HTML drag handlers and real
    // PATCH persistence, not physical mouse dragging. Only our fixture is moved.
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    await page.getByTestId(`card-task-${taskIds[0]}`).dispatchEvent("dragstart", { dataTransfer: transfer });
    await page.getByTestId("column-needs_review").dispatchEvent("dragover", { dataTransfer: transfer });
    await page.getByTestId("column-needs_review").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByTestId("column-needs_review").getByTestId(`card-task-${taskIds[0]}`)).toBeVisible();
    assert.equal((await (await context.request.get(`/api/tasks/${taskIds[0]}`)).json()).status, "needs_review");
    await page.getByTestId(`card-task-${taskIds[0]}`).click();
    await expect(page.getByTestId("task-detail-panel")).toBeVisible();
    await expect(page.getByTestId("input-task-title")).toHaveValue(`Kanban ${suffix} not_started`);
    await page.getByTestId("button-close-task-panel").click();
    await expect(page.getByTestId("task-detail-panel")).not.toBeVisible();
    assert.equal((await context.request.patch(`/api/tasks/${taskIds[0]}`, { data: { status: "not_started" } })).status(), 200);
  }
  // Archived status badges are the board's only task-status badges.
  for (const id of taskIds) assert.equal((await context.request.post(`/api/tasks/${id}/archive`)).status(), 200);
  await page.goto("/tasks");
  await page.getByTestId("select-sprint-filter").click();
  await page.getByRole("option", { name: "All sprints", exact: true }).click();
  await page.getByTestId("input-task-search").fill(`Kanban ${suffix}`);
  await page.getByTestId("button-view-archived").click();
  for (const theme of ["light", "dark"]) {
    const isDark = await page.locator("html").evaluate(el => el.classList.contains("dark"));
    if (isDark !== (theme === "dark")) await page.getByRole("button", { name: `Switch to ${theme} mode` }).click();
    await page.waitForTimeout(400);
    for (const [index, status] of statuses.entries()) {
      const card = page.getByTestId(`card-archived-task-${taskIds[index]}`);
      await expect(card.getByText(labels[index], { exact: true })).toBeVisible();
      const badge = await styles(`[data-testid="card-archived-task-${taskIds[index]}"] > div:last-child > span:first-child`);
      assert.ok(badge.contrast >= 4.5, `${theme} ${status} badge contrast: ${badge.contrast}`);
      assert.ok(badge.color !== "rgb(255, 111, 145)");
    }
  }
  assert.deepEqual(errors, []);
  console.log("PASS: both boards, both themes, header contrast/icons, matching columns, archived badges, detail opening, drag handlers and persisted status.");
} finally {
  await context.request.post("/api/auth/logout").catch(() => {});
  await browser.close();
  if (taskIds.length) {
    await pool.query("DELETE FROM task_activity WHERE task_id = ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM task_comments WHERE task_id = ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM task_assignees WHERE task_id = ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::int[])", [taskIds]);
  }
  if (userId) await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  await pool.end();
}
