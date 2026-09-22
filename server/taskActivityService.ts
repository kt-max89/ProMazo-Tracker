import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  milestonesTable,
  projectsTable,
  sprintsTable,
  taskActivityTable,
  tasksTable,
  usersTable,
} from "./schema";
import type { TaskActivity, TaskActivityEventType } from "@shared/schema";

type ActivityWriter = Pick<typeof db, "insert">;

export async function getActorName(actorId: number | null | undefined): Promise<string> {
  if (actorId == null) return "System";
  const [actor] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, actorId));
  return actor?.displayName ?? "Deleted user";
}

export async function recordTaskActivity(
  writer: ActivityWriter,
  input: {
    taskId: number;
    actorId: number | null;
    actorName: string;
    eventType: TaskActivityEventType;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await writer.insert(taskActivityTable).values({
    ...input,
    metadata: input.metadata ?? {},
  });
}

export async function listTaskActivity(taskId: number): Promise<TaskActivity[] | undefined> {
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) return undefined;

  const rows = await db
    .select()
    .from(taskActivityTable)
    .where(eq(taskActivityTable.taskId, taskId))
    .orderBy(asc(taskActivityTable.createdAt), asc(taskActivityTable.id));

  const activities: TaskActivity[] = rows.map(row => ({
    id: row.id,
    taskId: row.taskId,
    actorId: row.actorId,
    actorName: row.actorName,
    eventType: row.eventType as TaskActivityEventType,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  }));

  if (!rows.some(row => row.eventType === "created")) {
    const actorName = await getActorName(task.createdBy);
    activities.push({
      id: `legacy-created-${task.id}`,
      taskId: task.id,
      actorId: task.createdBy,
      actorName,
      eventType: "created",
      metadata: {},
      createdAt: task.createdAt.toISOString(),
      synthetic: true,
    });
    activities.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt) || String(a.id).localeCompare(String(b.id)),
    );
  }
  return activities;
}

export async function resolveTaskReferenceNames(input: {
  projectId?: number | null;
  milestoneId?: number | null;
  sprintId?: number | null;
}): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  if (input.projectId !== undefined) {
    const [row] = input.projectId == null ? [] : await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, input.projectId));
    result.project = row?.name ?? null;
  }
  if (input.milestoneId !== undefined) {
    const [row] = input.milestoneId == null ? [] : await db.select({ name: milestonesTable.name }).from(milestonesTable).where(eq(milestonesTable.id, input.milestoneId));
    result.milestone = row?.name ?? null;
  }
  if (input.sprintId !== undefined) {
    const [row] = input.sprintId == null ? [] : await db.select({ number: sprintsTable.number }).from(sprintsTable).where(eq(sprintsTable.id, input.sprintId));
    result.sprint = row ? `Sprint ${row.number}` : null;
  }
  return result;
}

export async function resolveUserNames(userIds: number[]): Promise<Map<number, string>> {
  const names = new Map<number, string>();
  for (const id of Array.from(new Set(userIds))) {
    const [row] = await db.select({ name: usersTable.displayName }).from(usersTable).where(eq(usersTable.id, id));
    names.set(id, row?.name ?? "Deleted user");
  }
  return names;
}