import { asc, eq, inArray, and } from "drizzle-orm";
import { db } from "./db";
import { teamsTable, usersTable, projectsTable, projectTeamsTable } from "./schema";
import type { Team } from "@shared/schema";

function mapTeam(row: typeof teamsTable.$inferSelect): Team {
  return { id: row.id, name: row.name, socialContract: row.socialContract, createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt) };
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
      const projects = await tx.select().from(projectsTable).where(inArray(projectsTable.id, ids)).orderBy(asc(projectsTable.id)).for("update");
      if (projects.length !== ids.length) throw new Error("Project not found");
      for (const project of projects) {
        if (project.teamId != null) await tx.insert(projectTeamsTable).values({ projectId: project.id, teamId: project.teamId }).onConflictDoNothing();
      }
      await tx.insert(projectTeamsTable).values(ids.map(projectId => ({ projectId, teamId: team.id }))).onConflictDoNothing();
      for (const project of projects) {
        if (project.teamId == null) await tx.update(projectsTable).set({ teamId: team.id, updatedAt: new Date() }).where(eq(projectsTable.id, project.id));
      }
    }
    await tx.update(usersTable).set({ teamId: team.id }).where(eq(usersTable.id, userId));
    return mapTeam(team);
  });
}

export async function updateTeam(id: number, socialContract: string): Promise<Team> {
  const [row] = await db.update(teamsTable).set({ socialContract }).where(eq(teamsTable.id, id)).returning();
  if (!row) throw new Error("Team not found");
  return mapTeam(row);
}

export async function changeProjectLink(teamId: number, projectId: number, add: boolean): Promise<Team> {
  return db.transaction(async tx => {
    const [team] = await tx.select().from(teamsTable).where(eq(teamsTable.id, teamId));
    if (!team) throw new Error("Team not found");
    const [project] = await tx.select().from(projectsTable).where(eq(projectsTable.id, projectId)).for("update");
    if (!project) throw new Error("Project not found");
    if (project.teamId != null) await tx.insert(projectTeamsTable).values({ projectId, teamId: project.teamId }).onConflictDoNothing();
    if (add) await tx.insert(projectTeamsTable).values({ projectId, teamId }).onConflictDoNothing();
    else await tx.delete(projectTeamsTable).where(and(eq(projectTeamsTable.projectId, projectId), eq(projectTeamsTable.teamId, teamId)));
    const links = await tx.select().from(projectTeamsTable).where(eq(projectTeamsTable.projectId, projectId)).orderBy(asc(projectTeamsTable.teamId));
    // Keep legacy compatibility in sync so a repeated additive backfill cannot
    // resurrect a dropped link.
    await tx.update(projectsTable).set({ teamId: links[0]?.teamId ?? null, updatedAt: new Date() }).where(eq(projectsTable.id, projectId));
    return mapTeam(team);
  });
}

export async function switchTeam(userId: number, teamId: number | null): Promise<void> {
  if (teamId != null && !(await getTeam(teamId))) throw new Error("Team not found");
  const rows = await db.update(usersTable).set({ teamId }).where(eq(usersTable.id, userId)).returning({ id: usersTable.id });
  if (!rows.length) throw new Error("User not found");
}