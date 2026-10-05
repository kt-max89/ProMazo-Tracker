import { randomUUID } from "node:crypto";
import { Client, type Pool } from "pg";
import { changeSchema, type LiveDomain } from "../shared/live";

// One dedicated listener (outside the ten-connection REST/session pool) per process.
// Revision polling is a shared, supported fallback for transaction-pooling proxies.
export class LiveCoordinator {
  private listener?: Client;
  private timer?: ReturnType<typeof setInterval>;
  private revisions = new Map<string, number>();
  private subscribers = new Set<(domain: LiveDomain | "recovery") => void>();
  private scanning = false;
  private connecting = false;
  private stopped = true;
  private nextConnect = 0;
  private failures = 0;
  listening = false;
  constructor(private pool: Pool, private connectionString: string | undefined) {}
  subscribe(fn: (domain: LiveDomain | "recovery") => void) {
    this.subscribers.add(fn);
    return () => { this.subscribers.delete(fn); };
  }
  private emit(domain: LiveDomain | "recovery") { this.subscribers.forEach(fn => fn(domain)); }
  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    await this.scan();
    this.timer = setInterval(() => {
      void this.scan();
      if (!this.listener && Date.now() >= this.nextConnect) void this.connect();
    }, 3000);
    this.timer.unref();
    void this.connect();
  }
  private async connect() {
    if (this.stopped || this.connecting) return;
    this.connecting = true;
    const client = new Client({ connectionString: this.connectionString, connectionTimeoutMillis: 5000, query_timeout: 5000 });
    this.listener = client;
    const failed = () => {
      if (this.listener !== client) return;
      this.listener = undefined;
      this.listening = false;
      this.emit("recovery");
      void client.end().catch(() => {});
    };
    client.on("error", failed);
    client.on("end", failed);
    try {
      await client.connect();
      await client.query("LISTEN tracker_live");
      // Confirm delivery through a DIFFERENT connection, not merely that LISTEN parses.
      const probe = randomUUID();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { client.off("notification", onProbe); reject(new Error("LISTEN delivery probe timed out")); }, 2500);
        const onProbe = (message: { payload?: string }) => {
          if (message.payload !== probe) return;
          clearTimeout(timeout); client.off("notification", onProbe); resolve();
        };
        client.on("notification", onProbe);
        void this.pool.query("SELECT pg_notify('tracker_live', $1)", [probe]).catch(error => {
          clearTimeout(timeout); client.off("notification", onProbe); reject(error);
        });
      });
      if (this.stopped || this.listener !== client) { await client.end(); return; }
      client.on("notification", () => { void this.scan(); });
      this.listening = true;
      this.failures = 0;
      this.nextConnect = 0;
      console.info("[live] Cross-connection LISTEN/NOTIFY verified");
      this.emit("recovery");
    } catch {
      this.failures++;
      this.nextConnect = Date.now() + Math.min(60_000, 3000 * 2 ** Math.min(this.failures, 5));
      console.warn("[live] Listener unavailable; shared PostgreSQL revision polling remains enabled");
      failed();
    } finally { this.connecting = false; }
  }
  private async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const rows = await this.pool.query<{ domain: string; revision: number }>("SELECT domain, revision FROM live_revisions");
      for (const row of rows.rows) {
        const parsed = changeSchema.safeParse({ domain: row.domain });
        if (!parsed.success) continue;
        if (this.revisions.get(row.domain) !== row.revision) {
          this.revisions.set(row.domain, row.revision);
          this.emit(parsed.data.domain);
        }
      }
    } catch {
      this.listening = false;
      const client = this.listener;
      this.listener = undefined;
      void client?.end().catch(() => {});
      this.emit("recovery");
    } finally { this.scanning = false; }
  }
  async publish(domain: LiveDomain) {
    try {
      await this.pool.query(`WITH changed AS (
        INSERT INTO live_revisions(domain, revision) VALUES ($1, 1)
        ON CONFLICT(domain) DO UPDATE SET revision = (live_revisions.revision % 2147483646) + 1
        RETURNING domain
      ) SELECT pg_notify('tracker_live', domain) FROM changed`, [domain]);
    } catch {
      // A saved record is still saved. The client safety refresh covers missed signals.
      console.warn("[live] Change notification unavailable; saved data is unchanged");
    }
  }
  async stop() {
    this.stopped = true;
    clearInterval(this.timer);
    const client = this.listener;
    this.listener = undefined;
    this.listening = false;
    await client?.end().catch(() => {});
  }
}