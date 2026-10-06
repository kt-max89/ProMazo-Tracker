import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { projectsTable, projectSprintPlansTable as plans, sprintsTable } from "./schema";
import type { ProjectSprintPlan } from "@shared/schema";

export class SprintPlanError extends Error {
  constructor(public status: number, message: string, public existingPlan?: ProjectSprintPlan) {
    super(message);
  }
}

const selection = {
  id: plans.id, projectId: plans.projectId, sprintId: plans.sprintId,
  content: plans.content, createdAt: plans.createdAt, updatedAt: plans.updatedAt,
  sprintNumber: sprintsTable.number,
};
function mapPlan(row: typeof plans.$inferSelect & { sprintNumber: number }): ProjectSprintPlan {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
async function requireProject(projectId: number) {
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) throw new SprintPlanError(404, "Project not found");
}
export async function listSprintPlans(projectId: number): Promise<ProjectSprintPlan[]> {
  await requireProject(projectId);
  const rows = await db.select(selection).from(plans).innerJoin(sprintsTable, eq(plans.sprintId, sprintsTable.id))
    .where(eq(plans.projectId, projectId)).orderBy(desc(sprintsTable.number));
  return rows.map(mapPlan);
}

// Chat discovery never loads every historical Markdown document into memory.
export async function listSprintPlanSummaries(projectIds: number[], sprintId?: number) {
  if (!projectIds.length) return [];
  const rows = await db.select({
    id: plans.id, projectId: plans.projectId, sprintId: plans.sprintId,
    sprintNumber: sprintsTable.number, updatedAt: plans.updatedAt,
    contentLength: sql<number>`length(${plans.content})`,
  }).from(plans).innerJoin(sprintsTable, eq(plans.sprintId, sprintsTable.id))
    .where(and(inArray(plans.projectId, projectIds), sprintId == null ? undefined : eq(plans.sprintId, sprintId)))
    .orderBy(desc(sprintsTable.number), desc(plans.id));
  return rows.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function readSprintPlanExcerpt(projectId: number, planId: number, offset: number, size: number) {
  const [row] = await db.select({
    // Cast bound values: PostgreSQL otherwise selects the text/regex overload.
    content: sql<string>`substring(${plans.content} from ${offset + 1}::integer for ${size}::integer)`,
    contentLength: sql<number>`length(${plans.content})`,
  }).from(plans).where(and(eq(plans.projectId, projectId), eq(plans.id, planId)));
  if (!row) throw new SprintPlanError(404, "Sprint plan not found");
  return row;
}
export async function getSprintPlan(projectId: number, planId: number): Promise<ProjectSprintPlan> {
  await requireProject(projectId);
  const [row] = await db.select(selection).from(plans).innerJoin(sprintsTable, eq(plans.sprintId, sprintsTable.id))
    .where(and(eq(plans.projectId, projectId), eq(plans.id, planId)));
  if (!row) throw new SprintPlanError(404, "Sprint plan not found");
  return mapPlan(row);
}
export async function createSprintPlan(projectId: number, input: { sprintId: number; content: string }): Promise<ProjectSprintPlan> {
  await requireProject(projectId);
  const [sprint] = await db.select({ id: sprintsTable.id }).from(sprintsTable).where(eq(sprintsTable.id, input.sprintId));
  if (!sprint) throw new SprintPlanError(404, "Sprint not found");
  // ON CONFLICT handles concurrent creators without aborting or overwriting.
  const [created] = await db.insert(plans).values({ projectId, ...input })
    .onConflictDoNothing({ target: [plans.projectId, plans.sprintId] }).returning();
  if (created) return getSprintPlan(projectId, created.id);
  const [existing] = await db.select(selection).from(plans).innerJoin(sprintsTable, eq(plans.sprintId, sprintsTable.id))
    .where(and(eq(plans.projectId, projectId), eq(plans.sprintId, input.sprintId)));
  throw new SprintPlanError(409, "A plan already exists for this sprint. Open the existing plan instead.", mapPlan(existing));
}
export async function updateSprintPlan(projectId: number, planId: number, content: string): Promise<ProjectSprintPlan> {
  await requireProject(projectId);
  const [updated] = await db.update(plans).set({ content, updatedAt: new Date() })
    .where(and(eq(plans.projectId, projectId), eq(plans.id, planId))).returning();
  if (!updated) throw new SprintPlanError(404, "Sprint plan not found");
  return getSprintPlan(projectId, planId);
}