import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { pool } from "./db";
import { requireAuth } from "./auth";
import { LiveCoordinator } from "./liveCoordinator";
import { presenceInputSchema, safePages, PRESENCE_LEASE_SECONDS, type LiveDomain } from "../shared/live";

export const liveCoordinator = new LiveCoordinator(pool, process.env.DATABASE_URL);
const connections = new Set<{ req: Request; res: Response; userId: number; version: number }>();

export function mutationDomains(method: string, path: string): LiveDomain[] {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return [];
  if (/^\/api\/tasks(?:\/|$)/.test(path)) return ["tasks"];
  if (/^\/api\/projects\/\d+\/sprint-plans(?:\/|$)/.test(path)) return ["plans"];
  if (/^\/api\/projects\/\d+\/milestones(?:\/|$)/.test(path) || /^\/api\/milestones(?:\/|$)/.test(path)) return ["milestones"];
  if (/^\/api\/projects(?:\/|$)/.test(path)) return ["projects"];
  if (/^\/api\/teams(?:\/|$)/.test(path)) return ["teams"];
  if (/^\/api\/(sprints|sprint-settings)(?:\/|$)/.test(path)) return ["sprints"];
  if (/^\/api\/team-posts(?:\/|$)/.test(path)) return ["posts"];
  if (/^\/api\/reflections(?:\/|$)/.test(path)) return ["reflections"];
  return [];
}

function sameOrigin(req: Request, res: Response, next: () => void) {
  const origin = req.get("origin");
  // Modern browsers send Origin for writes. Non-browser callers may omit it.
  if (req.get("sec-fetch-site") === "cross-site" || (origin && (() => {
    try { return new URL(origin).host !== req.get("host"); } catch { return true; }
  })())) return res.status(403).json({ message: "Cross-origin live requests are not allowed" });
  next();
}

async function validSessions() {
  const sessions = Array.from(new Set(Array.from(connections).map(c => c.req.sessionID)));
  const result = await pool.query(`SELECT s.sid, u.id, u.auth_version,
    s.sess->'passport'->'user' AS identity FROM session s
    JOIN users u ON u.id::text=COALESCE(s.sess->'passport'->'user'->>'id',s.sess->'passport'->>'user')
    WHERE s.sid=ANY($1::text[]) AND s.expire>now() AND u.is_active`, [sessions]);
  return new Map(result.rows.filter(row => {
    const version = typeof row.identity === "number" ? 0 : row.identity?.authVersion;
    return row.auth_version === version;
  }).map(row => [row.sid, { id: row.id, version: row.auth_version }]));
}

function send(res: Response, event: string, data: unknown) {
  // Drop slow consumers rather than allowing an unbounded SSE write queue.
  if (res.writableEnded || res.writableLength > 32_768) { res.end(); return; }
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function listPresence() {
  const result = await pool.query(`SELECT DISTINCT ON (p.user_id) p.user_id AS id,
    u.display_name AS "displayName", p.active, p.page
    FROM presence_leases p JOIN users u ON u.id=p.user_id
    JOIN session s ON s.sid=p.session_id
    WHERE p.expires_at > now() AND s.expire > now() AND u.is_active AND u.auth_version=p.auth_version
    ORDER BY p.user_id, p.active DESC, p.seen_at DESC LIMIT 200`);
  return result.rows.map(row => ({
    id: row.id, displayName: row.displayName,
    state: row.active ? "active" : "idle",
    page: safePages[row.page as keyof typeof safePages] ?? safePages.private,
  }));
}

export async function removeSessionPresence(sessionId: string) {
  await pool.query("DELETE FROM presence_leases WHERE session_id=$1", [sessionId]);
  await liveCoordinator.publish("presence");
}

export async function registerLive(app: Express, server: Server) {
  await liveCoordinator.start();
  app.use((req, res, next) => {
    const domains = mutationDomains(req.method, req.path);
    if (domains.length) res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) domains.forEach(domain => { void liveCoordinator.publish(domain); });
    });
    next();
  });
  app.get("/api/live/presence", requireAuth, async (_req, res) => {
    try { res.json(await listPresence()); } catch { res.status(503).json({ message: "Presence temporarily unavailable" }); }
  });
  app.get("/api/live/status", requireAuth, (_req, res) => {
    res.json({ mode: liveCoordinator.listening ? "listen-notify" : "shared-revision-polling", leaseSeconds: PRESENCE_LEASE_SECONDS });
  });
  app.post("/api/live/presence", requireAuth, sameOrigin, async (req, res) => {
    const parsed = presenceInputSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid presence heartbeat" });
    const { tabId, page, active } = parsed.data;
    try {
      // A per-user database lock enforces tab/heartbeat limits across instances.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [req.user!.id + 920000]);
        const limit = await client.query(`SELECT count(*)::int AS count,
          max(seen_at) FILTER (WHERE session_id=$2 AND tab_id=$3) AS last
          FROM presence_leases WHERE user_id=$1 AND expires_at>now()`, [req.user!.id, req.sessionID, tabId]);
        const previous = limit.rows[0].last;
        if ((previous && Date.now() - new Date(previous).getTime() < 2000) || (!previous && limit.rows[0].count >= 12)) {
          await client.query("ROLLBACK"); return res.status(429).json({ message: "Presence heartbeat limit reached" });
        }
        // Check status/version again under this write; a deactivated session cannot restore a lease.
        const written = await client.query(`INSERT INTO presence_leases(session_id,tab_id,user_id,auth_version,page,active,seen_at,expires_at)
          SELECT $1,$2,id,auth_version,$5,$6,now(),now()+($7 * interval '1 second')
          FROM users WHERE id=$3 AND is_active AND auth_version=$4
          ON CONFLICT(session_id,tab_id) DO UPDATE SET page=EXCLUDED.page, active=EXCLUDED.active,
          seen_at=EXCLUDED.seen_at,expires_at=EXCLUDED.expires_at`,
        [req.sessionID, tabId, req.user!.id, req.user!.authVersion, page, active, PRESENCE_LEASE_SECONDS]);
        if (written.rowCount !== 1) {
          await client.query("ROLLBACK"); return res.status(401).json({ message: "Unauthorized" });
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      await liveCoordinator.publish("presence");
      return res.sendStatus(204);
    } catch { return res.status(503).json({ message: "Presence temporarily unavailable" }); }
  });
  app.delete("/api/live/presence/:tabId", requireAuth, sameOrigin, async (req, res) => {
    if (!presenceInputSchema.shape.tabId.safeParse(req.params.tabId).success) return res.sendStatus(400);
    try {
      await pool.query("DELETE FROM presence_leases WHERE session_id=$1 AND tab_id=$2", [req.sessionID, req.params.tabId]);
      await liveCoordinator.publish("presence"); res.sendStatus(204);
    } catch { res.sendStatus(503); }
  });
  app.get("/api/live/events", requireAuth, sameOrigin, (req, res) => {
    if (connections.size >= 200 || Array.from(connections).filter(c => c.userId === req.user!.id).length >= 12) {
      return res.status(429).json({ message: "Live connection limit reached" });
    }
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const connection = { req, res, userId: req.user!.id, version: req.user!.authVersion };
    connections.add(connection);
    send(res, "ready", { mode: liveCoordinator.listening ? "live" : "fallback" });
    req.on("close", () => connections.delete(connection));
  });

  // Serialize fanout/revalidation. Burst signals coalesce, including presence heartbeats.
  const pending = new Set<LiveDomain | "recovery">();
  let flushing = false;
  let lastFlush = 0;
  const flush = async () => {
    if (flushing || connections.size === 0) return;
    if (!pending.size && Date.now() - lastFlush < 10000) return;
    lastFlush = Date.now();
    flushing = true;
    const domains = Array.from(pending); pending.clear();
    try {
      const presence = domains.includes("presence") ? await listPresence() : undefined;
      const sessions = await validSessions();
      for (const connection of Array.from(connections)) {
        try {
          const session = sessions.get(connection.req.sessionID);
          if (session?.id !== connection.userId || session.version !== connection.version) {
            send(connection.res, "revoked", {}); connection.res.end(); connections.delete(connection);
            continue;
          }
          for (const domain of domains) {
            if (domain === "presence") send(connection.res, "presence", presence);
            else if (domain === "recovery") send(connection.res, "ready", { mode: liveCoordinator.listening ? "live" : "fallback" });
            else send(connection.res, "change", { domain });
          }
          send(connection.res, "heartbeat", { mode: liveCoordinator.listening ? "live" : "fallback" });
        } catch { connection.res.end(); connections.delete(connection); }
      }
    } catch {
      // If account/session verification is unavailable, fail closed. Never send
      // data/presence from an unverified long-lived connection.
      connections.forEach(c => { c.res.end(); });
      connections.clear();
    } finally { flushing = false; }
  };
  const unsubscribe = liveCoordinator.subscribe(domain => pending.add(domain));
  const timer = setInterval(() => { void flush(); }, 1000); timer.unref();
  const cleanup = setInterval(() => {
    void pool.query(`DELETE FROM presence_leases WHERE (session_id,tab_id) IN
      (SELECT session_id,tab_id FROM presence_leases WHERE expires_at<=now() LIMIT 500)`)
      .then(result => { if (result.rowCount) void liveCoordinator.publish("presence"); }).catch(() => {});
    pending.add("presence"); // Expiry visible even if a suspended instance never runs cleanup.
  }, 10000); cleanup.unref();
  const shutdown = () => {
    clearInterval(timer); clearInterval(cleanup);
    unsubscribe();
    connections.forEach(c => c.res.end());
    void liveCoordinator.stop();
  };
  server.once("close", shutdown);
}