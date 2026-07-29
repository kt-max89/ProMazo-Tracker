/**
 * One-time data migrations that run on server startup.
 * Each migration is idempotent — safe to run multiple times.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Clear stored allowedUsers email lists from all documents.
 *
 * Background: the UI previously let admins store per-document email allow-lists.
 * That feature has been removed — the UI now always sends allowedUsers: [] and
 * the backend treats an empty list as "all users have access". Documents saved
 * before the change may still carry non-empty lists that would silently lock
 * users out. This migration resets them all to [] in one pass.
 */
async function clearDocumentAllowedUsers(): Promise<void> {
  const result = await db.execute(
    sql`UPDATE documents
        SET allowed_users = '[]'::jsonb
        WHERE allowed_users IS NOT NULL
          AND jsonb_array_length(allowed_users) > 0`
  );
  const count = (result as any).rowCount ?? 0;
  if (count > 0) {
    console.log(`[migrations] Cleared allowedUsers from ${count} document(s)`);
  }
}

export async function runMigrations(): Promise<void> {
  await clearDocumentAllowedUsers();
}
