import { eq } from "drizzle-orm";
import { db } from "./db";
import { tasks } from "@shared/schema";
import type { Task, InsertTask } from "@shared/schema";
import { z } from "zod";

export type TaskFilters = { archived?: boolean };

const VALID_STATUSES = ["not_started", "in_progress", "blocked", "done"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const archived = filters.archived ?? false;
  return db.select().from(tasks).where(eq(tasks.isArchived, archived));
}

export async function createTask(input: InsertTask): Promise<Task> {
  if (!input.title?.trim()) {
    throw new Error("Title is required");
  }
  if (input.status && !VALID_STATUSES.includes(input.status as TaskStatus)) {
    throw new Error(`Status must be one of: ${VALID_STATUSES.join(", ")}`);
  }
  if (input.status === "blocked" && !input.blockedReason?.trim()) {
    throw new Error("Blocked reason is required when status is blocked");
  }
  const now = new Date().toISOString();
  const [task] = await db
    .insert(tasks)
    .values({ ...input, createdAt: now, updatedAt: now })
    .returning();
  return task;
}

export async function updateTask(id: number, input: Partial<InsertTask>): Promise<Task> {
  if (input.title !== undefined && !input.title?.trim()) {
    throw new Error("Title is required");
  }
  if (input.status !== undefined && !VALID_STATUSES.includes(input.status as TaskStatus)) {
    throw new Error(`Status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const updates: Partial<InsertTask> = { ...input };

  if (input.status === "blocked") {
    if (input.blockedReason !== undefined) {
      if (!input.blockedReason.trim()) {
        throw new Error("Blocked reason is required when status is blocked");
      }
    } else {
      const [existing] = await db.select().from(tasks).where(eq(tasks.id, id));
      if (!existing) throw new Error("Task not found");
      if (!existing.blockedReason?.trim()) {
        throw new Error("Blocked reason is required when status is blocked");
      }
    }
  }

  if (input.status && input.status !== "blocked") {
    updates.blockedReason = null;
  }

  const now = new Date().toISOString();
  const [task] = await db
    .update(tasks)
    .set({ ...updates, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  if (!task) throw new Error("Task not found");
  return task;
}

export async function archiveTask(id: number): Promise<Task> {
  const now = new Date().toISOString();
  const [task] = await db
    .update(tasks)
    .set({ isArchived: true, archivedAt: now, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  if (!task) throw new Error("Task not found");
  return task;
}

export async function restoreTask(id: number): Promise<Task> {
  const now = new Date().toISOString();
  const [task] = await db
    .update(tasks)
    .set({ isArchived: false, archivedAt: null, updatedAt: now })
    .where(eq(tasks.id, id))
    .returning();
  if (!task) throw new Error("Task not found");
  return task;
}
