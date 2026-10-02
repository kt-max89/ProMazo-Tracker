import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { milestonesTable, tasksTable, sprintsTable } from "./schema";
import type { Milestone, InsertMilestone, UpdateMilestone } from "@shared/schema";

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapMilestone(row: typeof milestonesTable.$inferSelect, sprintIds: number[]): Milestone {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    timeline: row.timeline,
    excludedSprintIds: row.excludedSprintIds,
    sprintIds: sprintIds.filter(id => !row.excludedSprintIds.includes(id)),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

async function currentSprintIds() {
  return (await db.select({ id: sprintsTable.id }).from(sprintsTable)).map(s => s.id);
}

export async function validateExclusions(ids: number[]): Promise<number[]> {
  const unique = Array.from(new Set(ids)).sort((a,b) => a-b);
  if (unique.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid sprint");
  if (unique.length) {
    const rows = await db.select().from(sprintsTable).where(inArray(sprintsTable.id, unique));
    if (rows.length !== unique.length) throw new Error("Sprint not found");
  }
  return unique;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listMilestones(): Promise<Milestone[]> {
  const rows = await db.select().from(milestonesTable);
  const sprintIds = await currentSprintIds();
  return rows.map(row => mapMilestone(row, sprintIds));
}

export async function listMilestonesByProject(projectId: number): Promise<Milestone[]> {
  const rows = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  const sprintIds = await currentSprintIds();
  return rows.map(row => mapMilestone(row, sprintIds));
}

export async function getMilestone(id: number): Promise<Milestone | undefined> {
  const [row] = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.id, id));
  return row ? mapMilestone(row, await currentSprintIds()) : undefined;
}

export async function createMilestone(input: InsertMilestone): Promise<Milestone> {
  if (!input.name?.trim()) throw new Error("Name is required");
  const excludedSprintIds = await validateExclusions(input.excludedSprintIds ?? []);

  const [row] = await db
    .insert(milestonesTable)
    .values({
      projectId: input.projectId,
      name: input.name.trim(),
      description: input.description ?? null,
      timeline: input.timeline ?? null,
      excludedSprintIds,
    })
    .returning();
  return mapMilestone(row, await currentSprintIds());
}

export async function updateMilestone(id: number, input: UpdateMilestone): Promise<Milestone> {
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");

  const set: Partial<typeof milestonesTable.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.timeline !== undefined) set.timeline = input.timeline;
  if (input.excludedSprintIds !== undefined) set.excludedSprintIds = await validateExclusions(input.excludedSprintIds);

  const [updated] = await db
    .update(milestonesTable)
    .set(set)
    .where(eq(milestonesTable.id, id))
    .returning();
  if (!updated) throw new Error("Milestone not found");
  return mapMilestone(updated, await currentSprintIds());
}

export async function deleteMilestone(id: number): Promise<void> {
  // Clear milestone reference from tasks before deleting
  await db
    .update(tasksTable)
    .set({ milestoneId: null })
    .where(eq(tasksTable.milestoneId, id));

  await db.delete(milestonesTable).where(eq(milestonesTable.id, id));
}
