import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import bcrypt from "bcrypt";
import express from "express";
import { createServer } from "node:http";
import { validateRegistrationCode } from "../server/registrationCode";
import { registerSchema, userAccessActionSchema } from "../shared/schema";

test("registration codes are exact, required, and fail closed", () => {
  const code = "disposable-test-code";
  assert.equal(validateRegistrationCode(code, code), "valid");
  for (const invalid of ["", code.toUpperCase(), `${code} `, ` ${code}`, "wrong"]) {
    assert.equal(validateRegistrationCode(invalid, code), "invalid");
  }
  assert.equal(validateRegistrationCode(code, ""), "unconfigured");
  assert.equal(registerSchema.safeParse({ email: "test@example.com", password: "test-password", displayName: "Test" }).success, false);
  assert.equal(userAccessActionSchema.safeParse({ action: "promote", role: "admin" }).success, false);
});

test("admin access, registration, session revocation, bootstrap, and concurrent last-admin protection", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  // All data changes are confined to a temporary schema, never real accounts.
  const originalUrl = process.env.DATABASE_URL!;
  const adminPool = new Pool({ connectionString: originalUrl });
  const schema = `access_test_${randomUUID().replaceAll("-", "")}`;
  let appPool: Pool | undefined;
  const app = express();
  const server = createServer(app);
  const password = `Disposable-${randomUUID()}`;
  const code = `test-code-${randomUUID()}`;
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await adminPool.query(`
      CREATE TABLE "${schema}".teams (id serial PRIMARY KEY);
      CREATE TABLE "${schema}".users (
        id serial PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
        display_name text NOT NULL, role text NOT NULL DEFAULT 'user', team_id integer,
        is_active boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 0
      );
      CREATE TABLE "${schema}".tracker_settings (
        id integer PRIMARY KEY, initial_admin_configured boolean NOT NULL DEFAULT false
      );
      INSERT INTO "${schema}".tracker_settings VALUES (1, false);
      CREATE TABLE "${schema}".session (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
    `);
    const hash = await bcrypt.hash(password, 4);
    const inserted = await adminPool.query<{ id: number }>(
      `INSERT INTO "${schema}".users(email,password_hash,display_name,role)
       VALUES ('initial@example.com',$1,'Initial','user'),
              ('other@example.com',$1,'Other','admin'),
              ('member@example.com',$1,'Member','user') RETURNING id`,
      [hash],
    );
    const [initial, other, member] = inserted.rows.map(row => row.id);
    const isolatedUrl = new URL(originalUrl);
    isolatedUrl.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = isolatedUrl.toString();
    process.env.INITIAL_ADMIN_EMAIL = "initial@example.com";
    process.env.REGISTRATION_CODE = code;
    const dbModule = await import("../server/db");
    appPool = dbModule.pool;
    const { initializeInitialAdminAccess, changeUserAccess } = await import("../server/userAccessService");
    await initializeInitialAdminAccess();
    const roles = await appPool.query("SELECT id, role, is_active, password_hash FROM users ORDER BY id");
    assert.deepEqual(roles.rows.map(row => row.role), ["admin", "user", "user"]);
    assert.ok(roles.rows.every(row => row.is_active && row.password_hash === hash));
    const { registerRoutes } = await import("../server/routes");
    app.use(express.json());
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    async function api(path: string, method = "GET", body?: unknown, cookie?: string) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: await response.json(),
        cookie: response.headers.get("set-cookie")?.split(";")[0] };
    }
    async function login(email: string) {
      const result = await api("/api/auth/login", "POST", { email, password });
      assert.equal(result.status, 200);
      assert.ok(result.cookie);
      assert.equal(result.data.passwordHash, undefined);
      assert.equal(result.data.authVersion, undefined);
      return result.cookie!;
    }
    const initialCookie = await login("initial@example.com");
    const otherCookie = await login("other@example.com");
    const memberCookie = await login("member@example.com");
    assert.equal((await api("/api/admin/users")).status, 403);
    assert.equal((await api("/api/admin/users", "GET", undefined, memberCookie)).status, 403);
    const list = await api("/api/admin/users", "GET", undefined, initialCookie);
    assert.equal(list.status, 200);
    assert.ok(list.data.every((user: any) => !("passwordHash" in user) && !("authVersion" in user)));
    for (const action of ["demote", "deactivate"]) {
      assert.equal((await api(`/api/admin/users/${initial}`, "PATCH", { action }, initialCookie)).status, 409);
    }
    assert.equal((await api(`/api/admin/users/${member}`, "PATCH", { action: "promote" }, memberCookie)).status, 403);
    assert.equal((await api(`/api/admin/users/${member}`, "PATCH", { action: "delete" }, initialCookie)).status, 400);
    assert.equal((await api("/api/admin/users/999999", "PATCH", { action: "promote" }, initialCookie)).status, 404);
    const signup = { email: "signup@example.com", password, displayName: "Signup" };
    assert.equal((await api("/api/auth/register", "POST", signup)).status, 400);
    assert.equal((await api("/api/auth/register", "POST", { ...signup, registrationCode: "wrong" })).status, 403);
    delete process.env.REGISTRATION_CODE;
    assert.equal((await api("/api/auth/register", "POST", { ...signup, registrationCode: code })).status, 503);
    process.env.REGISTRATION_CODE = code;
    assert.equal((await appPool.query("SELECT count(*)::int AS n FROM users")).rows[0].n, 3);
    const registered = await api("/api/auth/register", "POST", {
      ...signup, registrationCode: code, role: "admin", isActive: false, authVersion: 99,
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.data.role, "user");
    assert.equal(registered.data.isActive, true);
    assert.equal((await api("/api/auth/me", "GET", undefined, registered.cookie)).status, 200);
    assert.equal((await api("/api/auth/register", "POST", { ...signup, registrationCode: code })).status, 409);

    await changeUserAccess(initial, other, "promote");
    await initializeInitialAdminAccess();
    assert.equal((await api("/api/admin/users", "GET", undefined, otherCookie)).status, 200, "bootstrap must not undo later promotions");
    await changeUserAccess(initial, other, "demote");
    assert.equal((await api("/api/admin/users", "GET", undefined, otherCookie)).status, 403, "existing sessions use fresh roles");
    await changeUserAccess(initial, member, "deactivate");
    assert.equal((await api("/api/auth/login", "POST", { email: "member@example.com", password })).status, 401);
    assert.equal((await api("/api/auth/me", "GET", undefined, memberCookie)).status, 401);
    await changeUserAccess(initial, member, "reactivate");
    assert.equal((await api("/api/auth/me", "GET", undefined, memberCookie)).status, 401, "old sessions stay revoked after reactivation");
    await login("member@example.com");
    await changeUserAccess(initial, other, "promote");
    const results = await Promise.allSettled([
      changeUserAccess(initial, other, "demote"),
      changeUserAccess(other, initial, "deactivate"),
    ]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal((await appPool.query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND is_active")).rows[0].n, 1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await appPool?.end();
    process.env.DATABASE_URL = originalUrl;
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  }
});