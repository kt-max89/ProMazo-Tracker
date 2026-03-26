import { eq, ilike, or, sql } from "drizzle-orm";
import { db } from "./db";
import { tasks } from "@shared/schema";
import type { Task, InsertTask } from "@shared/schema";

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

export type TaskCounts = Record<string, number>;

export async function getTaskCounts(): Promise<TaskCounts> {
  const rows = await db
    .select({ status: tasks.status, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.isArchived, false))
    .groupBy(tasks.status);

  const counts: TaskCounts = {
    not_started: 0,
    in_progress: 0,
    blocked: 0,
    done: 0,
  };
  for (const row of rows) {
    counts[row.status] = row.count;
  }
  return counts;
}

export async function getTasksByStatus(status: string): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      sql`${tasks.status} = ${status} AND ${tasks.isArchived} = false`
    );
}

export async function searchTasks(query: string): Promise<Task[]> {
  const term = `%${query}%`;
  return db
    .select()
    .from(tasks)
    .where(
      sql`${tasks.isArchived} = false AND (${tasks.title} ILIKE ${term} OR ${tasks.description} ILIKE ${term})`
    );
}

function formatTaskLine(t: Task): string {
  let line = `- [${t.status}] ${t.title}`;
  if (t.assignedTo) line += ` (assigned to user #${t.assignedTo})`;
  if (t.status === "blocked" && t.blockedReason) line += ` — blocked: ${t.blockedReason}`;
  return line;
}

export async function getCompactTaskContext(message: string): Promise<string> {
  const lower = message.toLowerCase();
  const parts: string[] = [];

  const counts = await getTaskCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  parts.push(
    `Task counts (active): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, done=${counts.done}`
  );

  const statusKeywords: { keyword: string; status: string }[] = [
    { keyword: "blocked", status: "blocked" },
    { keyword: "in progress", status: "in_progress" },
    { keyword: "in-progress", status: "in_progress" },
    { keyword: "not started", status: "not_started" },
    { keyword: "done", status: "done" },
    { keyword: "complete", status: "done" },
    { keyword: "open", status: "not_started" },
  ];

  const fetchedStatuses = new Set<string>();
  for (const { keyword, status } of statusKeywords) {
    if (lower.includes(keyword) && !fetchedStatuses.has(status)) {
      fetchedStatuses.add(status);
      const matched = await getTasksByStatus(status);
      if (matched.length > 0) {
        parts.push(`\n${status} tasks:`);
        matched.slice(0, 10).forEach((t) => parts.push(formatTaskLine(t)));
      } else {
        parts.push(`\n${status} tasks: none`);
      }
    }
  }

  const genericTaskTerms = ["task", "what", "show", "list", "all", "board"];
  const wantsAll = genericTaskTerms.some((w) => lower.includes(w)) && fetchedStatuses.size === 0;
  if (wantsAll) {
    const all = await listTasks({ archived: false });
    if (all.length > 0) {
      parts.push("\nAll active tasks:");
      all.slice(0, 20).forEach((t) => parts.push(formatTaskLine(t)));
    } else {
      parts.push("\nAll active tasks: none");
    }
  }

  const searchTerms = message.match(/["']([^"']+)["']/g)?.map((s) => s.replace(/["']/g, ""));
  if (searchTerms) {
    for (const term of searchTerms) {
      const found = await searchTasks(term);
      if (found.length > 0) {
        parts.push(`\nTasks matching "${term}":`);
        found.slice(0, 5).forEach((t) => parts.push(formatTaskLine(t)));
      }
    }
  }

  return parts.join("\n");
}
