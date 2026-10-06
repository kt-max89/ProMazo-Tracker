import { pool } from "../server/db";
import { applyReflectionSchema } from "../server/reflectionMigration";

if (process.env.NODE_ENV !== "development" || !process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("This schema command is restricted to the development database.");
}
try {
  await applyReflectionSchema(pool);
  console.log("Reflection addition development schema applied.");
} finally { await pool.end(); }
