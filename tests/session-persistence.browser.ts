import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { chromium, expect, type BrowserContext } from "@playwright/test";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import { sessionDatabase } from "./helpers/session-database";

const previewOnly = process.argv.includes("--preview-only");
const fixture = previewOnly ? undefined : await sessionDatabase();
const profile = await mkdtemp(path.join(tmpdir(), "session-browser-"));
const secret = randomUUID(); // Stable across both disposable server processes.
let child: ChildProcess | undefined;
let context: BrowserContext | undefined;
const browserOptions = {
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
};
async function start(port = 0) {
  child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/session-server.ts"], {
    env: { ...process.env, DATABASE_URL: fixture!.url, SESSION_SECRET: secret,
      SESSION_TEST_PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const running = child;
  return await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Isolated server startup timed out")), 30_000);
    running.once("exit", () => { clearTimeout(timer); reject(new Error("Isolated server exited before ready")); });
    // Do not print server logs, connection strings, cookies, or credentials.
    running.stdout!.on("data", data => {
      const match = /SESSION_TEST_READY:(\d+)/.exec(String(data));
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
  child = undefined;
}
try {
  if (!previewOnly) {
  const port = await start();
  const baseURL = `http://127.0.0.1:${port}`;
  context = await chromium.launchPersistentContext(profile, { ...browserOptions, baseURL });
  let page = await context.newPage();
  // An unresolved initial session check must reveal neither private content nor login.
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/auth/me", async route => { await blocked; await route.continue(); });
  await page.goto("/history");
  await expect(page.getByTestId("session-loading")).toBeVisible();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  await expect(page.getByTestId("history-page")).toHaveCount(0);
  release();
  await expect(page.getByTestId("auth-page")).toBeVisible();
  await page.unroute("**/api/auth/me");
  await page.getByTestId("input-email").fill("member@example.com");
  await page.getByTestId("input-password").fill(fixture!.password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("history-page")).toBeVisible();
  assert.equal(new URL(page.url()).pathname, "/history", "login on a deep link keeps the destination");
  const cookie = (await context.cookies()).find(c => c.name === "connect.sid")!;
  assert.ok(cookie.httpOnly && cookie.sameSite === "Lax" && !cookie.secure);
  assert.ok(Math.abs(cookie.expires * 1000 - Date.now() - 30 * 86400000) < 3000);
  // Closing the persistent context closes the entire Chromium process, not just a tab.
  await context.close();
  context = undefined;
  await stop();
  await start(port);
  context = await chromium.launchPersistentContext(profile, { ...browserOptions, baseURL });
  page = await context.newPage();
  await page.goto("/history");
  await expect(page.getByTestId("history-page")).toBeVisible();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  assert.equal(new URL(page.url()).pathname, "/history");
  await page.goto("/auth");
  await expect(page).toHaveURL(baseURL + "/");
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  // A transient server error must not become a login screen or discard the URL.
  await page.route("**/api/auth/me", route => route.fulfill({
    status: 503, contentType: "application/json", body: '{"message":"Temporary test outage"}',
  }));
  await page.goto("/history");
  await expect(page.getByTestId("session-error")).toBeVisible();
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  await page.unroute("**/api/auth/me");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("history-page")).toBeVisible();
  assert.equal(new URL(page.url()).pathname, "/history");
  // Verify the existing poll renews the cookie, not just a hand-written request.
  const previousExpiry = (await context.cookies()).find(c => c.name === "connect.sid")!.expires;
  const poll = page.waitForResponse(r => r.url().endsWith("/api/auth/me") && r.status() === 200, { timeout: 40_000 });
  await poll;
  await expect.poll(async () => (await context!.cookies()).find(c => c.name === "connect.sid")!.expires,
    { timeout: 5000 }).toBeGreaterThan(previousExpiry);
  const out = await context.request.post("/api/auth/logout");
  assert.equal(out.status(), 200);
  assert.equal((await context.cookies()).some(c => c.name === "connect.sid"), false);
  await page.reload();
  await expect(page.getByTestId("auth-page")).toBeVisible();
  console.log("PASS: persistent browser profile + server-process restart, deep links, startup gates, retry, poll renewal, logout");
  }
} finally {
  await context?.close();
  await stop();
  await fixture?.cleanup();
  await rm(profile, { recursive: true, force: true });
}

// Verify the real HTTPS edge with only a disposable account, never real users.
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("REPLIT_DEV_DOMAIN is required for HTTPS preview verification");
const previewPool = new Pool({ connectionString: process.env.DATABASE_URL });
const email = `session-preview-${randomUUID()}@example.com`;
const password = `Disposable-${randomUUID()}`;
const browser = await chromium.launch(browserOptions);
let userId: number | undefined;
try {
  const result = await previewPool.query(`INSERT INTO users(email,password_hash,display_name,role)
    VALUES($1,$2,'Session Preview Test','user') RETURNING id`, [email, await bcrypt.hash(password, 4)]);
  userId = result.rows[0].id;
  const preview = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
  const page = await preview.newPage();
  await page.goto("/history");
  await expect(page.getByTestId("auth-page")).toBeVisible();
  await page.getByTestId("input-email").fill(email);
  await page.getByTestId("input-password").fill(password);
  await page.getByTestId("button-submit-auth").click();
  await expect(page.getByTestId("history-page")).toBeVisible();
  const cookie = (await preview.cookies()).find(c => c.name === "connect.sid")!;
  assert.ok(cookie.secure, "HTTPS preview cookie is Secure");
  assert.ok(cookie.httpOnly, "HTTPS preview cookie is HttpOnly");
  // The preview edge rewrites cookies for its cross-site iframe. Origin-level
  // integration tests assert Lax; the public preview may expose None instead.
  assert.ok(cookie.sameSite === "Lax" || cookie.sameSite === "None");
  assert.ok(Math.abs(cookie.expires * 1000 - Date.now() - 30 * 86400000) < 3000);
  await page.goto("/auth");
  await expect(page).toHaveURL(`https://${process.env.REPLIT_DEV_DOMAIN}/`);
  await expect(page.getByTestId("auth-page")).toHaveCount(0);
  await page.goto("/history");
  await expect(page.getByTestId("history-page")).toBeVisible();
  const logout = await preview.request.post("/api/auth/logout");
  assert.equal(logout.status(), 200);
  const cleared = logout.headers()["set-cookie"];
  assert.ok(/; Secure/.test(cleared));
  assert.ok(/HttpOnly/.test(cleared));
  assert.ok(/SameSite=(Lax|None)/i.test(cleared));
  assert.equal((await preview.cookies()).some(c => c.name === "connect.sid"), false);
  console.log(`PASS: HTTPS preview Secure/HttpOnly persistent cookie (edge SameSite=${cookie.sameSite}), deep links, /auth redirect and cookie clearing`);
} finally {
  await browser.close();
  if (userId) {
    await previewPool.query("DELETE FROM presence_leases WHERE user_id=$1", [userId]);
    await previewPool.query("DELETE FROM session WHERE sess->'passport'->'user'->>'id'=$1", [String(userId)]);
    await previewPool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await previewPool.end();
}
