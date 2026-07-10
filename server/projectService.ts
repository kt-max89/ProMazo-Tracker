import { eq } from "drizzle-orm";
import { db } from "./db";
import { projectsTable } from "./schema";
import type { Project, InsertProject, UpdateProject } from "@shared/schema";

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapProject(row: typeof projectsTable.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    timeline: row.timeline,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listProjects(): Promise<Project[]> {
  const rows = await db.select().from(projectsTable);
  return rows.map(mapProject);
}

export async function getProject(id: number): Promise<Project | undefined> {
  const [row] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  return row ? mapProject(row) : undefined;
}

export async function createProject(input: InsertProject): Promise<Project> {
  if (!input.name?.trim()) throw new Error("Name is required");

  const [row] = await db
    .insert(projectsTable)
    .values({
      name: input.name.trim(),
      description: input.description ?? null,
      timeline: input.timeline ?? null,
    })
    .returning();
  return mapProject(row);
}

export async function updateProject(id: number, input: UpdateProject): Promise<Project> {
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");

  const set: Partial<typeof projectsTable.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.timeline !== undefined) set.timeline = input.timeline;

  const [updated] = await db
    .update(projectsTable)
    .set(set)
    .where(eq(projectsTable.id, id))
    .returning();
  if (!updated) throw new Error("Project not found");
  return mapProject(updated);
}

export async function deleteProject(id: number): Promise<void> {
  await db.delete(projectsTable).where(eq(projectsTable.id, id));
}
