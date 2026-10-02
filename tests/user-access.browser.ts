// Opt-in signed-in check against the development preview. Disposable accounts
// use the real login flow; existing accounts and document records are untouched.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import bcrypt from "bcrypt";
import { pool } from "../server/db";

const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const suffix = randomUUID().slice(0, 8);
const password = `Disposable-${randomUUID()}`;
const ids: number[] = [];
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
try {
  const hash = await bcrypt.hash(password, 4);
  const rows = await pool.query<{ id: number }>(
    `INSERT INTO users(email,password_hash,display_name,role)
     VALUES ($1,$2,$3,'admin'),($4,$2,$5,'user') RETURNING id`,
    [`access-admin-${suffix}@example.com`, hash, `Access Admin ${suffix}`,
      `access-member-${suffix}@example.com`, `Access Member ${suffix}`],
  );
  ids.push(...rows.rows.map(row => row.id));
  const [adminId, memberId] = ids;
  await page.goto("/auth");
  await expect(page.getByTestId("input-registration-code")).toHaveCount(0);
  await page.getByTestId("button-toggle-auth-mode").click();
  const code = page.getByTestId("input-registration-code");
  await expect(code).toHaveAttribute("type", "password");
  await expect(code).toHaveAttribute("required", "");
  await page.getByTestId("button-toggle-auth-mode").click();
  await page.getByTestId("input-email").fill(`access-admin-${suffix}@example.com`);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "User management" })).toBeVisible();
  await expect(page.getByTestId("admin-page")).toBeVisible();
  const management = page.locator("section[aria-labelledby='user-management-title']");
  assert.ok(await management.evaluate(el => el.nextElementSibling !== null), "document controls remain after user management");
  const memberRow = page.getByTestId(`user-row-${memberId}`);
  await expect(memberRow).toContainText("User");
  await page.getByTestId(`button-promote-user-${memberId}`).click();
  await expect(page.getByTestId(`button-demote-user-${memberId}`)).toBeVisible();
  await expect(memberRow).toContainText("Admin");
  await page.getByTestId(`button-demote-user-${memberId}`).click();
  await expect(page.getByTestId(`button-promote-user-${memberId}`)).toBeVisible();
  await page.getByTestId(`button-deactivate-user-${memberId}`).click();
  await expect(memberRow).toContainText("Inactive");
  await expect(page.getByTestId(`button-promote-user-${memberId}`)).toBeDisabled();
  await page.getByTestId(`button-reactivate-user-${memberId}`).click();
  await expect(page.getByTestId(`button-deactivate-user-${memberId}`)).toBeVisible();
  await page.setViewportSize({ width: 402, height: 874 });
  await expect(memberRow).toBeVisible();
  const overflow = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    elements: [...document.querySelectorAll("*")].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8).map(el => ({ tag: el.tagName, classes: el.className })),
  }));
  assert.ok(overflow.width <= overflow.viewport + 1, `mobile Settings overflow: ${JSON.stringify(overflow)}`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId(`button-demote-user-${adminId}`).click();
  await expect(page.getByTestId("admin-page")).toHaveCount(0);
  assert.equal((await context.request.get("/api/admin/users")).status(), 403);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [adminId]);
  await page.reload();
  await expect(page.getByTestId("admin-page")).toBeVisible();
  await page.getByTestId(`button-deactivate-user-${adminId}`).click();
  await expect(page.getByTestId("auth-page")).toBeVisible();
  assert.equal((await context.request.get("/api/auth/me")).status(), 401);
  assert.deepEqual(errors, []);
  console.log("Signed-in Settings actions, self-demotion/deactivation, masked signup code, and mobile layout passed.");
} finally {
  await context.close();
  await browser.close();
  if (ids.length) {
    await pool.query(`DELETE FROM session WHERE
      (sess->'passport'->'user'->>'id') = ANY($1::text[]) OR
      (sess->'passport'->>'user') = ANY($1::text[])`, [ids.map(String)]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [ids]);
  }
  await pool.end();
}