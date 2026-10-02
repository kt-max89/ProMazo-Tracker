import { asc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { trackerSettingsTable, usersTable } from "./schema";
import type { ManagedUser, UserAccessAction } from "@shared/schema";

// Every role/status change and initial reconciliation share this lock.
// Rechecking the actor inside it prevents a demoted admin from winning a race.
const ACCESS_LOCK = 820021;
const safeFields = {
  id: usersTable.id,
  email: usersTable.email,
  displayName: usersTable.displayName,
  role: usersTable.role,
  teamId: usersTable.teamId,
  isActive: usersTable.isActive,
};

export class UserAccessError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function listManagedUsers(): Promise<ManagedUser[]> {
  return await db.select(safeFields).from(usersTable)
    .orderBy(asc(usersTable.displayName), asc(usersTable.id)) as ManagedUser[];
}

export async function changeUserAccess(
  actorId: number,
  targetId: number,
  action: UserAccessAction,
): Promise<ManagedUser> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACCESS_LOCK})`);
    const [actor] = await tx.select(safeFields).from(usersTable).where(eq(usersTable.id, actorId));
    if (!actor?.isActive || actor.role !== "admin") {
      throw new UserAccessError(403, "Active admin access required");
    }
    const [target] = await tx.select(safeFields).from(usersTable).where(eq(usersTable.id, targetId));
    if (!target) throw new UserAccessError(404, "User not found");

    if (target.role === "admin" && target.isActive && (action === "demote" || action === "deactivate")) {
      const activeAdmins = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(sql`${usersTable.role} = 'admin' AND ${usersTable.isActive} = true`);
      if (activeAdmins.length <= 1) {
        throw new UserAccessError(409, "The last active admin cannot be demoted or deactivated. Promote another active user first.");
      }
    }

    const changes = action === "promote" ? { role: "admin" }
      : action === "demote" ? { role: "user" }
      : action === "reactivate" ? { isActive: true }
      : { isActive: false, authVersion: sql`${usersTable.authVersion} + 1` };
    const [updated] = await tx.update(usersTable).set(changes)
      .where(eq(usersTable.id, targetId)).returning(safeFields);
    if (action === "deactivate") {
      // Remove stored sessions, including pre-versioned Passport sessions.
      await tx.execute(sql`
        DELETE FROM session
        WHERE sess->'passport'->>'user' = ${String(targetId)}
           OR sess->'passport'->'user'->>'id' = ${String(targetId)}
      `);
    }
    return updated as ManagedUser;
  });
}

/**
 * One-time data-only reconciliation. Schema application is handled by the
 * development schema flow / Publish, never by new startup DDL.
 */
export async function initializeInitialAdminAccess(): Promise<void> {
  const email = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    console.warn("[user-access] Initial admin setup not configured; existing roles preserved.");
    return;
  }
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ACCESS_LOCK})`);
    const [settings] = await tx.select({ configured: trackerSettingsTable.initialAdminConfigured })
      .from(trackerSettingsTable).where(eq(trackerSettingsTable.id, 1));
    if (settings?.configured) return;
    if (!settings) throw new Error("Initial admin setup requires tracker settings.");
    const candidates = await tx.select({ id: usersTable.id }).from(usersTable)
      .where(sql`lower(${usersTable.email}) = ${email}`);
    if (candidates.length !== 1) {
      throw new Error("Initial admin account is missing or ambiguous; no accounts were changed.");
    }
    const designatedId = candidates[0].id;
    await tx.update(usersTable).set({
      role: sql`CASE WHEN ${usersTable.id} = ${designatedId} THEN 'admin' ELSE 'user' END`,
    });
    await tx.update(usersTable).set({ isActive: true }).where(eq(usersTable.id, designatedId));
    await tx.update(trackerSettingsTable).set({ initialAdminConfigured: true })
      .where(eq(trackerSettingsTable.id, 1));
    console.log("[user-access] Initial admin reconciliation completed; accounts and work preserved.");
  });
}