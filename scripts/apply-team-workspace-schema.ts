import { pool } from "../server/db";
import { applyTeamWorkspaceSchema } from "../server/teamWorkspaceMigration";

if (process.env.NODE_ENV !== "development" || !process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This schema command is restricted to the development database.");
}
try {
  await applyTeamWorkspaceSchema(pool);
  console.log("Team workspace development schema applied.");
} finally { await pool.end(); }