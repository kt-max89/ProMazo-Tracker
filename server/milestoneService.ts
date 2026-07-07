import { eq } from "drizzle-orm";
import { db } from "./db";
import { milestonesTable, tasksTable } from "./schema";
import type { Milestone, InsertMilestone, UpdateMilestone } from "@shared/schema";

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapMilestone(row: typeof milestonesTable.$inferSelect): Milestone {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    timeline: row.timeline,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listMilestones(): Promise<Milestone[]> {
  const rows = await db.select().from(milestonesTable);
  return rows.map(mapMilestone);
}

export async function listMilestonesByProject(projectId: number): Promise<Milestone[]> {
  const rows = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.projectId, projectId));
  return rows.map(mapMilestone);
}

export async function getMilestone(id: number): Promise<Milestone | undefined> {
  const [row] = await db
    .select()
    .from(milestonesTable)
    .where(eq(milestonesTable.id, id));
  return row ? mapMilestone(row) : undefined;
}

export async function createMilestone(input: InsertMilestone): Promise<Milestone> {
  if (!input.name?.trim()) throw new Error("Name is required");

  const [row] = await db
    .insert(milestonesTable)
    .values({
      projectId: input.projectId,
      name: input.name.trim(),
      description: input.description ?? null,
      timeline: input.timeline ?? null,
    })
    .returning();
  return mapMilestone(row);
}

export async function updateMilestone(id: number, input: UpdateMilestone): Promise<Milestone> {
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");

  const set: Partial<typeof milestonesTable.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.timeline !== undefined) set.timeline = input.timeline;

  const [updated] = await db
    .update(milestonesTable)
    .set(set)
    .where(eq(milestonesTable.id, id))
    .returning();
  if (!updated) throw new Error("Milestone not found");
  return mapMilestone(updated);
}

export async function deleteMilestone(id: number): Promise<void> {
  // Clear milestone reference from tasks before deleting
  await db
    .update(tasksTable)
    .set({ milestoneId: null })
    .where(eq(tasksTable.milestoneId, id));

  await db.delete(milestonesTable).where(eq(milestonesTable.id, id));
}
