import { pool } from "../server/db";

// Development/post-merge only. Production schema changes belong to Publish.
// The agent workspace can report REPLIT_ENVIRONMENT=production while using the
// managed development database; that flag is not a reliable deployment guard.
if (process.env.NODE_ENV !== "development" ||
    !process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This schema command is restricted to the development database.");
}

try {
  await pool.query(`
    BEGIN;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;
    ALTER TABLE tracker_settings ADD COLUMN IF NOT EXISTS initial_admin_configured boolean NOT NULL DEFAULT false;
    COMMIT;
  `);
  console.log("User-access development schema applied.");
} finally {
  await pool.end();
}