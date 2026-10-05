import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { LiveCoordinator } from "../server/liveCoordinator";
import { mutationDomains } from "../server/live";
import { changeSchema, presenceInputSchema, sharedQueryRoots } from "../shared/live";

test("minimal events and safe presence input reject private/arbitrary fields", () => {
  assert.equal(changeSchema.safeParse({ domain: "tasks", title: "secret" }).success, false);
  assert.equal(changeSchema.safeParse({ domain: "chat" }).success, false);
  const safe = { tabId: "5777fd6f-54cd-4d50-97eb-cf0219c591fb", page: "private", active: true };
  assert.equal(presenceInputSchema.safeParse(safe).success, true);
  assert.equal(presenceInputSchema.safeParse({ ...safe, displayName: "Forged identity" }).success, false);
  assert.equal(presenceInputSchema.safeParse({ ...safe, page: "Private chat title" }).success, false);
});

test("all shared mutation routes map to dependent query roots; private/admin routes excluded", () => {
  const paths: [string, string][] = [
    ["/api/tasks/1", "tasks"], ["/api/tasks/1/comments", "tasks"], ["/api/tasks/1/archive", "tasks"],
    ["/api/tasks/1/restore", "tasks"], ["/api/projects/1", "projects"],
    ["/api/projects/1/milestones", "milestones"], ["/api/milestones/1", "milestones"],
    ["/api/projects/1/sprint-plans/3", "plans"], ["/api/teams/membership", "teams"],
    ["/api/teams/1/projects/2", "teams"], ["/api/teams/1", "teams"],
    ["/api/sprints/next", "sprints"], ["/api/sprint-settings/current", "sprints"],
    ["/api/team-posts/1/pin", "posts"], ["/api/reflections", "reflections"],
  ];
  for (const [path, domain] of paths) {
    assert.deepEqual(mutationDomains("POST", path), [domain], path);
    assert.deepEqual(mutationDomains("GET", path), [], path);
  }
  for (const path of ["/api/chat", "/api/chat-sessions/3", "/api/documents/4", "/api/admin/users/4"]) {
    assert.deepEqual(mutationDomains("PATCH", path), []);
  }
  assert.ok(sharedQueryRoots.tasks.includes("/api/projects"));
  assert.ok(sharedQueryRoots.milestones.includes("/api/tasks"));
  assert.ok(sharedQueryRoots.teams.includes("/api/auth/me"));
});

test("independent coordinators receive shared changes with verified LISTEN and polling fallback", async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const first = new LiveCoordinator(pool, process.env.DATABASE_URL);
  // An invalid listener URL intentionally forces database-backed fallback.
  const fallback = new LiveCoordinator(pool, "postgres://invalid:invalid@127.0.0.1:1/invalid");
  const received: string[] = [];
  const unsub = fallback.subscribe(domain => received.push(domain));
  try {
    await first.start(); await fallback.start();
    await new Promise(resolve => setTimeout(resolve, 200));
    received.length = 0;
    await first.publish("posts");
    for (let i = 0; i < 40 && !received.includes("posts"); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(received.includes("posts"), "shared revisions deliver without a listener");
    assert.equal(fallback.listening, false);
    assert.equal(first.listening, true, "actual cross-connection notify round trip");
    const events: string[] = [];
    const stop = first.subscribe(domain => events.push(domain));
    await fallback.publish("reflections");
    for (let i = 0; i < 40 && !events.includes("reflections"); i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(events.includes("reflections"));
    await (first as any).listener.end();
    assert.equal(first.listening, false, "listener loss is reported, not hidden");
    for (let i = 0; i < 80 && !first.listening; i++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(first.listening, true, "dedicated listener reconnects and probes delivery again");
    stop();
  } finally { unsub(); await first.stop(); await fallback.stop(); await pool.end(); }
});