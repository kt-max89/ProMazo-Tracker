import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import bcrypt from "bcrypt";

// Every session test uses its own search_path, including the session table.
export async function sessionDatabase() {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `session_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const password = `Disposable-${randomUUID()}`;
  const hash = await bcrypt.hash(password, 4);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`
    CREATE TABLE "${schema}".users (
      id serial PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text NOT NULL,
      display_name text NOT NULL, role text NOT NULL DEFAULT 'user', team_id integer,
      is_active boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 0
    );
    CREATE TABLE "${schema}".session (sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
    CREATE TABLE "${schema}".live_revisions (domain text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0);
    CREATE TABLE "${schema}".presence_leases (
      session_id text, tab_id text, user_id integer, auth_version integer,
      page text, active boolean, seen_at timestamptz, expires_at timestamptz,
      PRIMARY KEY(session_id, tab_id)
    );
  `);
  await admin.query(`INSERT INTO "${schema}".users(email,password_hash,display_name,role)
    VALUES ('admin@example.com',$1,'Test Admin','admin'),('member@example.com',$1,'Test Member','user')`, [hash]);
  return {
    url: url.toString(), password,
    async cleanup() {
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
