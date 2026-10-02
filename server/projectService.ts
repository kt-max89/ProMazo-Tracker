import { asc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { projectsTable, projectTeamsTable, teamsTable, milestonesTable } from "./schema";
import type { Project, InsertProject, UpdateProject, InsertMilestone } from "@shared/schema";
import { validateExclusions } from "./milestoneService";

function mapProject(row: typeof projectsTable.$inferSelect, teamIds: number[]): Project {
  // Publish applies additive schema but not the development data backfill.
  // Include the compatibility value until each project is edited/backfilled.
  teamIds = Array.from(new Set([...teamIds, ...(row.teamId == null ? [] : [row.teamId])])).sort((a,b) => a-b);
  return {
    ...row, teamIds, teamId: teamIds[0] ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

export async function validateTeams(ids: number[], tx: any): Promise<number[]> {
  const unique = Array.from(new Set(ids)).sort((a, b) => a - b);
  if (unique.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid team");
  if (unique.length) {
    const teams = await tx.select({ id: teamsTable.id }).from(teamsTable).where(inArray(teamsTable.id, unique));
    if (teams.length !== unique.length) throw new Error("Team not found");
  }
  return unique;
}

async function replaceLinks(projectId: number, teamIds: number[], tx: any) {
  await tx.delete(projectTeamsTable).where(eq(projectTeamsTable.projectId, projectId));
  if (teamIds.length) await tx.insert(projectTeamsTable).values(teamIds.map(teamId => ({ projectId, teamId })));
}

export async function listProjects(): Promise<Project[]> {
  const [rows, links] = await Promise.all([
    db.select().from(projectsTable),
    db.select().from(projectTeamsTable).orderBy(asc(projectTeamsTable.teamId)),
  ]);
  return rows.map(row => mapProject(row, links.filter(link => link.projectId === row.id).map(link => link.teamId)));
}

export async function getProject(id: number): Promise<Project | undefined> {
  const [row] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!row) return undefined;
  const links = await db.select().from(projectTeamsTable).where(eq(projectTeamsTable.projectId, id)).orderBy(asc(projectTeamsTable.teamId));
  return mapProject(row, links.map(link => link.teamId));
}

export async function createProject(input: InsertProject, milestones: Omit<InsertMilestone, "projectId">[] = []): Promise<Project> {
  if (!input.name?.trim()) throw new Error("Name is required");
  const drafts = await Promise.all(milestones.map(async milestone => {
    if (!milestone.name?.trim()) throw new Error("Milestone name is required");
    return { ...milestone, name: milestone.name.trim(), excludedSprintIds: await validateExclusions(milestone.excludedSprintIds ?? []) };
  }));
  return db.transaction(async tx => {
    const teamIds = await validateTeams(input.teamIds ?? (input.teamId == null ? [] : [input.teamId]), tx);
    const [row] = await tx.insert(projectsTable).values({
      name: input.name.trim(), description: input.description ?? null,
      timeline: input.timeline ?? null, teamId: teamIds[0] ?? null,
    }).returning();
    await replaceLinks(row.id, teamIds, tx);
    if (drafts.length) await tx.insert(milestonesTable).values(drafts.map(draft => ({ ...draft, projectId: row.id })));
    return mapProject(row, teamIds);
  });
}

export async function updateProject(id: number, input: UpdateProject): Promise<Project> {
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");
  return db.transaction(async tx => {
    const [existing] = await tx.select().from(projectsTable).where(eq(projectsTable.id, id)).for("update");
    if (!existing) throw new Error("Project not found");
    const changingTeams = input.teamIds !== undefined || input.teamId !== undefined;
    const links = await tx.select().from(projectTeamsTable).where(eq(projectTeamsTable.projectId, id)).orderBy(asc(projectTeamsTable.teamId));
    const teamIds = changingTeams
      ? await validateTeams(input.teamIds ?? (input.teamId == null ? [] : [input.teamId]), tx)
      : Array.from(new Set([...links.map(link => link.teamId), ...(existing.teamId == null ? [] : [existing.teamId])])).sort((a,b) => a-b);
    const set: Partial<typeof projectsTable.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) set.name = input.name.trim();
    if (input.description !== undefined) set.description = input.description;
    if (input.timeline !== undefined) set.timeline = input.timeline;
    if (changingTeams) {
      await replaceLinks(id, teamIds, tx);
      set.teamId = teamIds[0] ?? null;
    }
    const [row] = await tx.update(projectsTable).set(set).where(eq(projectsTable.id, id)).returning();
    return mapProject(row, teamIds);
  });
}

export async function deleteProject(id: number): Promise<void> {
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}