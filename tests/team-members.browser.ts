// Opt-in browser verification against the development app; cleans up its own records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID().slice(0, 8);
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const teamIds: number[] = [];
let userId: number | undefined;
async function api(method: string, path: string, data?: unknown) {
  const response = await context.request.fetch(path, { method, data });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
  return response.json();
}

try {
  const displayName = `Roster Test ${suffix}`;
  const user = await api("POST", "/api/auth/register", {
    email: `roster-${suffix}@example.test`,
    password: `Disposable-${randomUUID()}`,
    displayName,
  });
  userId = user.id;
  const first = await api("POST", "/api/teams", { name: `Roster A ${suffix}`, projectIds: [] });
  teamIds.push(first.id);
  const second = await api("POST", "/api/teams", { name: `Roster B ${suffix}`, projectIds: [] });
  teamIds.push(second.id);

  await page.goto("/team-overview");
  const firstRoster = page.getByTestId(`team-members-${first.id}`);
  const secondRoster = page.getByTestId(`team-members-${second.id}`);
  await expect(firstRoster).toContainText("No members yet.");
  await expect(secondRoster).toContainText("1 member");
  await expect(secondRoster).toContainText(`${displayName} (you)`);

  await page.getByTestId(`team-row-${first.id}`).getByRole("button", { name: "Join team" }).click();
  await expect(firstRoster).toContainText(`${displayName} (you)`);
  await expect(secondRoster).toContainText("No members yet.");
  await page.getByRole("button", { name: "Leave team" }).click();
  await expect(firstRoster).toContainText("No members yet.");
  await expect(secondRoster).toContainText("No members yet.");

  // Team creation joins its creator and must refresh the member query too.
  const newName = `Roster C ${suffix}`;
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  await page.getByPlaceholder("e.g. Platform delivery").fill(newName);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create team", exact: true }).last().click();
  await expect(page.getByText(newName, { exact: true }).first()).toBeVisible();
  const created = (await api("GET", "/api/teams")).find((team: { name: string }) => team.name === newName);
  assert.ok(created);
  teamIds.push(created.id);
  await expect(page.getByTestId(`team-members-${created.id}`)).toContainText(`${displayName} (you)`);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId(`team-members-${created.id}`)).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    "Mobile page must not overflow horizontally");

  await page.route("**/api/users", route => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ message: "Test roster failure" }),
  }));
  await page.reload();
  await expect(page.getByTestId(`team-members-${created.id}`)).toContainText("Couldn’t load members.", { timeout: 20000 });
  await page.unroute("**/api/users");
  await page.getByTestId(`team-members-${created.id}`).getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId(`team-members-${created.id}`)).toContainText(`${displayName} (you)`);
  assert.deepEqual(errors, []);
  console.log("Team rosters: membership switching, leaving, creating, mobile layout, and error recovery passed.");
} finally {
  // Include any team created before a test failure so cleanup remains complete.
  const remaining = await pool.query("SELECT id FROM teams WHERE name = ANY($1::text[])",
    [[`Roster A ${suffix}`, `Roster B ${suffix}`, `Roster C ${suffix}`]]);
  const cleanupIds = [...new Set([...teamIds, ...remaining.rows.map(row => row.id)])];
  if (userId) {
    await pool.query("DELETE FROM session WHERE sess->'passport'->>'user' = $1", [String(userId)]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  }
  if (cleanupIds.length) await pool.query("DELETE FROM teams WHERE id = ANY($1::int[])", [cleanupIds]);
  await browser.close();
  await pool.end();
}