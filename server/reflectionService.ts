import { and, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { reflectionsTable, sprintsTable } from "./schema";
import type { InsertSprintReflection, SprintReflection } from "@shared/schema";

type ReflectionRow = {
  id: number;
  authorId: number | null;
  authorName: string;
  sprintId: number;
  sprintNumber: number;
  summary: string;
  wastes: SprintReflection["wastes"];
  kaizenWhat: string;
  kaizenWhy: string;
  kaizenDone: string;
  impact: string;
  createdAt: Date | string;
};

function mapReflection(row: ReflectionRow): SprintReflection {
  return {
    ...row,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

const selection = {
  id: reflectionsTable.id,
  authorId: reflectionsTable.authorId,
  authorName: reflectionsTable.authorName,
  sprintId: reflectionsTable.sprintId,
  sprintNumber: sprintsTable.number,
  summary: reflectionsTable.summary,
  wastes: reflectionsTable.wastes,
  kaizenWhat: reflectionsTable.kaizenWhat,
  kaizenWhy: reflectionsTable.kaizenWhy,
  kaizenDone: reflectionsTable.kaizenDone,
  impact: reflectionsTable.impact,
  createdAt: reflectionsTable.createdAt,
};

export async function listReflections(options: {
  limit?: number;
  sprintId?: number;
  authorId?: number;
} = {}): Promise<SprintReflection[]> {
  const conditions = [];
  if (options.sprintId != null) conditions.push(eq(reflectionsTable.sprintId, options.sprintId));
  if (options.authorId != null) conditions.push(eq(reflectionsTable.authorId, options.authorId));

  const baseQuery = db
    .select(selection)
    .from(reflectionsTable)
    .innerJoin(sprintsTable, eq(reflectionsTable.sprintId, sprintsTable.id))
    .where(and(...conditions))
    .orderBy(desc(reflectionsTable.createdAt), desc(reflectionsTable.id));

  const rows = options.limit == null ? await baseQuery : await baseQuery.limit(options.limit);
  return rows.map(mapReflection);
}

export async function createReflection(
  input: InsertSprintReflection & { authorId: number; authorName: string },
): Promise<SprintReflection> {
  const [sprint] = await db
    .select({ id: sprintsTable.id })
    .from(sprintsTable)
    .where(eq(sprintsTable.id, input.sprintId));
  if (!sprint) throw new Error("Sprint not found");

  const [created] = await db
    .insert(reflectionsTable)
    .values({
      authorId: input.authorId,
      authorName: input.authorName.trim(),
      sprintId: input.sprintId,
      summary: input.summary.trim(),
      wastes: input.wastes.map(waste => ({
        category: waste.category,
        description: waste.description.trim(),
      })),
      kaizenWhat: input.kaizenWhat.trim(),
      kaizenWhy: input.kaizenWhy.trim(),
      kaizenDone: input.kaizenDone.trim(),
      impact: input.impact.trim(),
    })
    .returning({ id: reflectionsTable.id });

  const [exact] = await db
    .select(selection)
    .from(reflectionsTable)
    .innerJoin(sprintsTable, eq(reflectionsTable.sprintId, sprintsTable.id))
    .where(eq(reflectionsTable.id, created.id));
  if (!exact) throw new Error("Reflection could not be loaded after creation");
  return mapReflection(exact);
}