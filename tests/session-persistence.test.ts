import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { sessionDatabase } from "./helpers/session-database";
import { sessionPolicy, SESSION_LIFETIME_MS } from "../server/sessionPolicy";

test("hosted sessions require a secret, limit proxy trust, and local HTTP remains supported", () => {
  const original = { ...process.env };
  try {
    delete process.env.SESSION_SECRET;
    delete process.env.REPL_ID;
    process.env.NODE_ENV = "production";
    assert.throws(() => sessionPolicy(express()), /SESSION_SECRET/);
    process.env.NODE_ENV = "development";
    const local = express();
    assert.equal(sessionPolicy(local).cookie?.secure, "auto");
    assert.equal(local.get("trust proxy"), false);
    process.env.REPL_ID = "test-host";
    assert.throws(() => sessionPolicy(express()), /SESSION_SECRET/);
    process.env.SESSION_SECRET = randomUUID();
    const hosted = express();
    sessionPolicy(hosted);
    assert.equal(hosted.get("trust proxy"), 1);
  } finally {
    process.env = original;
  }
});

test("persistent PostgreSQL sessions renew, resist fixation, expire, logout, and stay revoked", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const fixture = await sessionDatabase();
  const original = { ...process.env };
  process.env.DATABASE_URL = fixture.url;
  process.env.SESSION_SECRET = randomUUID();
  process.env.REGISTRATION_CODE = "isolated-registration";
  process.env.REPL_ID = "test-host";
  const { pool } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const { changeUserAccess } = await import("../server/userAccessService");
  const app = express();
  app.use(express.json());
  const server = createServer(app);
  try {
    await registerRoutes(server, app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    async function api(path: string, method = "GET", body?: unknown, cookie?: string, https = false) {
      const response = await fetch(base + path, {
        method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}),
          ...(https ? { "X-Forwarded-Proto": "https" } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // express-session may flush headers before its asynchronous store.touch
      // finishes. Wait for the complete response before inspecting PostgreSQL.
      await response.arrayBuffer();
      return { status: response.status, header: response.headers.get("set-cookie"),
        cookie: response.headers.get("set-cookie")?.split(";")[0] };
    }
    async function login(cookie?: string, https = false) {
      const result = await api("/api/auth/login", "POST", { email: "member@example.com", password: fixture.password }, cookie, https);
      assert.equal(result.status, 200);
      assert.ok(result.cookie);
      assert.ok(/HttpOnly/.test(result.header!));
      assert.ok(/SameSite=Lax/.test(result.header!));
      const expires = new Date(/Expires=([^;]+)/.exec(result.header!)![1]).getTime();
      assert.ok(Math.abs(expires - Date.now() - SESSION_LIFETIME_MS) < 2000);
      return result;
    }
    const anonymous = await api("/api/auth/me");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.header, null);
    assert.equal((await pool.query("SELECT count(*)::int n FROM session")).rows[0].n, 0);
    const first = await login();
    assert.ok(!/; Secure/.test(first.header!));
    const second = await login(first.cookie);
    assert.ok(first.cookie !== second.cookie, "Passport regenerates the session on login");
    assert.equal((await api("/api/auth/me", "GET", undefined, first.cookie)).status, 401);
    await pool.query(`UPDATE session SET expire=now()+interval '1 day',
      sess=jsonb_set(jsonb_set(sess::jsonb, '{cookie,originalMaxAge}', '86400000'),
        '{cookie,expires}', to_jsonb(now()+interval '1 day'))`);
    await new Promise(resolve => setTimeout(resolve, 1100));
    const renewed = await api("/api/auth/me", "GET", undefined, second.cookie);
    assert.equal(renewed.status, 200);
    assert.ok(renewed.cookie === second.cookie);
    const row = (await pool.query("SELECT extract(epoch from expire AT TIME ZONE 'UTC') * 1000 AS expiry_ms FROM session")).rows[0];
    const cookieExpiry = new Date(/Expires=([^;]+)/.exec(renewed.header!)![1]);
    assert.ok(Math.abs(Number(row.expiry_ms) - cookieExpiry.getTime()) <= 1000,
      `store and browser expiry agree (difference ${Number(row.expiry_ms) - cookieExpiry.getTime()}ms)`);
    assert.ok(Math.abs(Number(row.expiry_ms) - Date.now() - SESSION_LIFETIME_MS) < 2000);
    const registered = await api("/api/auth/register", "POST", {
      email: "signup@example.com", password: fixture.password, displayName: "Signup", registrationCode: "isolated-registration",
    });
    assert.equal(registered.status, 200);
    assert.ok(Math.abs(new Date(/Expires=([^;]+)/.exec(registered.header!)![1]).getTime() - Date.now() - SESSION_LIFETIME_MS) < 2000);
    const out = await api("/api/auth/logout", "POST", undefined, second.cookie);
    assert.equal(out.status, 200);
    assert.ok(/Expires=Thu, 01 Jan 1970/.test(out.header!));
    assert.ok(/HttpOnly; SameSite=Lax/.test(out.header!));
    assert.equal((await api("/api/auth/me", "GET", undefined, second.cookie)).status, 401);
    assert.equal((await pool.query("SELECT count(*)::int n FROM session WHERE sess->'passport'->'user'->>'id'='2'")).rows[0].n, 0);
    const expiring = await login();
    await pool.query("UPDATE session SET expire=now()-interval '1 second'");
    assert.equal((await api("/api/auth/me", "GET", undefined, expiring.cookie)).status, 401);
    const revoked = await login();
    // Preserve a copy to simulate an in-flight request writing an old session back.
    const saved = (await pool.query("SELECT * FROM session WHERE sess->'passport'->'user'->>'id'='2'")).rows[0];
    await changeUserAccess(1, 2, "deactivate");
    assert.equal((await api("/api/auth/me", "GET", undefined, revoked.cookie)).status, 401);
    await changeUserAccess(1, 2, "reactivate");
    await pool.query("INSERT INTO session(sid,sess,expire) VALUES($1,$2,$3)", [saved.sid, saved.sess, saved.expire]);
    assert.equal((await api("/api/auth/me", "GET", undefined, revoked.cookie)).status, 401, "version invalidation survives stale writes and reactivation");
    const deleted = await login();
    await pool.query("DELETE FROM users WHERE id=2");
    assert.equal((await api("/api/auth/me", "GET", undefined, deleted.cookie)).status, 401);
    // Forwarded HTTPS receives Secure, including the matching logout deletion.
    {
      const secure = await api("/api/auth/login", "POST", { email: "admin@example.com", password: fixture.password }, undefined, true);
      assert.ok(/; Secure/.test(secure.header!));
      assert.ok(/SameSite=Lax/.test(secure.header!));
      const cleared = await api("/api/auth/logout", "POST", undefined, secure.cookie, true);
      assert.ok(/; Secure/.test(cleared.header!));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
    process.env = original;
    await fixture.cleanup();
  }
});
