import { asc, desc, eq } from "drizzle-orm";
import { db } from "./db";
import { sprintsTable, trackerSettingsTable } from "./schema";
import type { Sprint, TrackerSettings } from "@shared/schema";

function mapSprint(row: typeof sprintsTable.$inferSelect): Sprint {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function listSprints(): Promise<Sprint[]> {
  const rows = await db.select().from(sprintsTable).orderBy(asc(sprintsTable.number));
  return rows.map(mapSprint);
}

export async function getSprint(id: number): Promise<Sprint | undefined> {
  const [row] = await db.select().from(sprintsTable).where(eq(sprintsTable.id, id));
  return row ? mapSprint(row) : undefined;
}

export async function getTrackerSettings(): Promise<TrackerSettings> {
  const [settings] = await db
    .select()
    .from(trackerSettingsTable)
    .where(eq(trackerSettingsTable.id, 1));
  return { currentSprintId: settings?.currentSprintId ?? null };
}

export async function setCurrentSprint(sprintId: number): Promise<TrackerSettings> {
  const sprint = await getSprint(sprintId);
  if (!sprint) throw new Error("Sprint not found");

  await db
    .update(trackerSettingsTable)
    .set({ currentSprintId: sprintId })
    .where(eq(trackerSettingsTable.id, 1));

  return { currentSprintId: sprintId };
}

/**
 * Adds the next numeric sprint. The unique constraint is authoritative; retrying
 * a collision handles two users creating a sprint at the same time.
 */
export async function createNextSprint(): Promise<Sprint> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [last] = await db
      .select()
      .from(sprintsTable)
      .orderBy(desc(sprintsTable.number))
      .limit(1);
    const number = (last?.number ?? 67) + 1;

    try {
      const [created] = await db.insert(sprintsTable).values({ number }).returning();
      return mapSprint(created);
    } catch (error: any) {
      if (error?.code !== "23505" || attempt === 2) throw error;
    }
  }

  throw new Error("Could not create the next sprint");
}