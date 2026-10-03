import { pool } from "../server/db";
import { applySprintPlanSchema } from "../server/sprintPlanMigration";

if (process.env.NODE_ENV !== "development" || !process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This schema command is restricted to the development database.");
}
try {
  await applySprintPlanSchema(pool);
  console.log("Project sprint plan development schema applied.");
} finally { await pool.end(); }