import { pool } from "../server/db";
if (process.env.NODE_ENV !== "development" || !process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This schema command is restricted to the development database.");
}
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS live_revisions (
    domain text PRIMARY KEY, revision integer NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS presence_leases (
    session_id text NOT NULL, tab_id text NOT NULL,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auth_version integer NOT NULL, page text NOT NULL, active boolean NOT NULL,
    seen_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
    PRIMARY KEY(session_id, tab_id)
  );
  CREATE INDEX IF NOT EXISTS presence_leases_expiry_idx ON presence_leases(expires_at);
  CREATE INDEX IF NOT EXISTS presence_leases_user_idx ON presence_leases(user_id);`);
  console.log("Live synchronization development schema applied.");
} finally { await pool.end(); }