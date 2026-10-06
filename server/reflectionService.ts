import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./db";
import { reflectionAdditionsTable, reflectionsTable, sprintsTable } from "./schema";
import { appendReflectionSchema, insertSprintReflectionSchema, type ReflectionAccess, type ReflectionAddition, type InsertSprintReflection, type SprintReflection } from "@shared/schema";

export type ReflectionViewer = { id: number; role: string; displayName: string };
export class ReflectionError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function reflectionAccess(viewer: ReflectionViewer): Promise<ReflectionAccess[]> {
  const [sprints, own] = await Promise.all([
    db.select().from(sprintsTable),
    db.select().from(reflectionsTable).where(eq(reflectionsTable.authorId, viewer.id)),
  ]);
  const submitted = new Set(own.filter(row => insertSprintReflectionSchema.safeParse(row).success).map(row => row.sprintId));
  return sprints.map(sprint => ({
    sprintId: sprint.id, sprintNumber: sprint.number, submitted: submitted.has(sprint.id),
    canRead: viewer.role === "admin" || submitted.has(sprint.id),
  }));
}

async function loadAdditions(ids: number[]): Promise<ReflectionAddition[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(reflectionAdditionsTable)
    .where(inArray(reflectionAdditionsTable.reflectionId, ids)).orderBy(asc(reflectionAdditionsTable.id));
  return rows.map(row => ({
    ...row, field: row.field as ReflectionAddition["field"],
    category: row.category as ReflectionAddition["category"] ?? undefined,
    wasteIndex: row.wasteIndex ?? undefined, wasteAdditionId: row.wasteAdditionId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }));
}

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

export async function listReflections(viewer: ReflectionViewer, options: {
  limit?: number;
  sprintId?: number;
  authorId?: number;
  id?: number;
} = {}): Promise<SprintReflection[]> {
  const conditions = [];
  if (viewer.role !== "admin") {
    const allowed = (await reflectionAccess(viewer)).filter(access => access.canRead).map(access => access.sprintId);
    conditions.push(or(eq(reflectionsTable.authorId, viewer.id), allowed.length ? inArray(reflectionsTable.sprintId, allowed) : sql`false`));
  }
  if (options.id != null) conditions.push(eq(reflectionsTable.id, options.id));
  if (options.sprintId != null) conditions.push(eq(reflectionsTable.sprintId, options.sprintId));
  if (options.authorId != null) conditions.push(eq(reflectionsTable.authorId, options.authorId));

  const baseQuery = db
    .select(selection)
    .from(reflectionsTable)
    .innerJoin(sprintsTable, eq(reflectionsTable.sprintId, sprintsTable.id))
    .where(and(...conditions))
    .orderBy(desc(reflectionsTable.createdAt), desc(reflectionsTable.id));

  const rows = options.limit == null ? await baseQuery : await baseQuery.limit(options.limit);
  const additions = await loadAdditions(rows.map(row => row.id));
  return rows.map(row => ({ ...mapReflection(row), additions: additions.filter(item => item.reflectionId === row.id) }));
}

export async function getReflection(viewer: ReflectionViewer, id: number): Promise<SprintReflection> {
  const [reflection] = await listReflections(viewer, { id });
  if (reflection) return reflection;
  const [exists] = await db.select({ id: reflectionsTable.id }).from(reflectionsTable).where(eq(reflectionsTable.id, id));
  throw new ReflectionError(exists ? 403 : 404, exists ? "Submit your own reflection for this sprint before viewing other reflections." : "Reflection not found");
}

export async function appendReflection(viewer: ReflectionViewer, id: number, input: unknown): Promise<SprintReflection> {
  const parsed = appendReflectionSchema.safeParse(input);
  if (!parsed.success) throw new ReflectionError(400, parsed.error.errors[0].message);
  await db.transaction(async tx => {
    // Serialize owner appends for validation only; history is separate INSERTs, never replaced.
    const [original] = await tx.select().from(reflectionsTable).where(eq(reflectionsTable.id, id)).for("update");
    if (!original) throw new ReflectionError(404, "Reflection not found");
    if (original.authorId !== viewer.id) throw new ReflectionError(403, "Only the author can add to this reflection");
    const history = await tx.select().from(reflectionAdditionsTable).where(eq(reflectionAdditionsTable.reflectionId, id));
    const effective = parsed.data.additions.filter(item => {
      let originalText: string | undefined;
      if (item.field === "wasteDescription") {
        if (item.wasteIndex != null) {
          const waste = original.wastes[item.wasteIndex];
          if (!waste) throw new ReflectionError(400, "Waste target not found");
          originalText = waste.description;
        } else {
          const waste = history.find(row => row.id === item.wasteAdditionId && row.field === "newWaste");
          if (!waste) throw new ReflectionError(400, "Waste target not found");
          originalText = waste.text;
        }
      } else if (item.field !== "newWaste") {
        originalText = original[item.field];
      }
      if (originalText?.trim() === item.text) return false;
      return !history.some(row => row.field === item.field && row.text === item.text &&
        row.wasteIndex === (item.wasteIndex ?? null) && row.wasteAdditionId === (item.wasteAdditionId ?? null) &&
        row.category === (item.category ?? null));
    });
    if (!effective.length) throw new ReflectionError(400, "Add some new text; unchanged answers are not additions");
    await tx.insert(reflectionAdditionsTable).values(effective.map(item => ({
      ...item, reflectionId: id, authorId: viewer.id, authorName: viewer.displayName,
    })));
  });
  return getReflection(viewer, id);
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