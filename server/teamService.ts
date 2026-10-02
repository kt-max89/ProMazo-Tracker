import { asc, eq, inArray, and, isNull } from "drizzle-orm";
import { db } from "./db";
import { teamsTable, usersTable, projectsTable } from "./schema";
import type { Team } from "@shared/schema";

function mapTeam(row: typeof teamsTable.$inferSelect): Team {
  return { id: row.id, name: row.name, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
}

export class TeamClaimConflict extends Error {
  constructor() {
    super("One or more selected projects were claimed by another team. Refresh the project selection and try again.");
  }
}

export async function listTeams(): Promise<Team[]> {
  return (await db.select().from(teamsTable).orderBy(asc(teamsTable.id))).map(mapTeam);
}

export async function getTeam(id: number): Promise<Team | undefined> {
  const [row] = await db.select().from(teamsTable).where(eq(teamsTable.id, id));
  return row ? mapTeam(row) : undefined;
}

export async function createTeam(userId: number, name: string, projectIds: number[] = []): Promise<Team> {
  if (!name.trim()) throw new Error("Team name is required");
  const ids = Array.from(new Set(projectIds)).sort((a, b) => a - b);
  return db.transaction(async tx => {
    // Lock membership first, consistently across creation/switching.
    const [user] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    if (!user) throw new Error("User not found");
    const [team] = await tx.insert(teamsTable).values({ name: name.trim() }).returning();
    if (ids.length) {
      // Conditional UPDATE rechecks team_id after concurrent writers finish.
      // A partial claim causes the entire transaction to roll back.
      const claimed = await tx.update(projectsTable)
        .set({ teamId: team.id, updatedAt: new Date() })
        .where(and(inArray(projectsTable.id, ids), isNull(projectsTable.teamId)))
        .returning({ id: projectsTable.id });
      if (claimed.length !== ids.length) throw new TeamClaimConflict();
    }
    await tx.update(usersTable).set({ teamId: team.id }).where(eq(usersTable.id, userId));
    return mapTeam(team);
  });
}

export async function switchTeam(userId: number, teamId: number | null): Promise<void> {
  if (teamId != null && !(await getTeam(teamId))) throw new Error("Team not found");
  const rows = await db.update(usersTable).set({ teamId }).where(eq(usersTable.id, userId)).returning({ id: usersTable.id });
  if (!rows.length) throw new Error("User not found");
}