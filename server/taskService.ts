import { eq, and, or, ilike } from "drizzle-orm";
import { db } from "./db";
import { tasksTable } from "./schema";
import type { Task, InsertTask } from "@shared/schema";
import { getProject } from "./projectService";
import { getMilestone } from "./milestoneService";

export type TaskFilters = { archived?: boolean };

const VALID_STATUSES = ["not_started", "in_progress", "blocked", "needs_review", "done"] as const;
type TaskStatus = (typeof VALID_STATUSES)[number];

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapTask(row: typeof tasksTable.$inferSelect): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    blockedReason: row.blockedReason,
    isArchived: row.isArchived,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    createdBy: row.createdBy,
    archivedAt: row.archivedAt
      ? (row.archivedAt instanceof Date ? row.archivedAt.toISOString() : String(row.archivedAt))
      : null,
    assignedTo: row.assignedTo,
    projectId: row.projectId,
    milestoneId: row.milestoneId ?? null,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const archived = filters.archived ?? false;
  const rows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.isArchived, archived));
  return rows.map(mapTask);
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
  if (input.projectId != null) {
    const proj = await getProject(input.projectId);
    if (!proj) throw new Error("Project not found");
  }

  // Milestone validation
  if (input.projectId != null && input.milestoneId == null) {
    throw new Error("A milestone is required when a project is selected");
  }
  if (input.milestoneId != null) {
    const ms = await getMilestone(input.milestoneId);
    if (!ms) throw new Error("Milestone not found");
    if (ms.projectId !== input.projectId) {
      throw new Error("Milestone does not belong to the selected project");
    }
  }

  const [row] = await db
    .insert(tasksTable)
    .values({
      title: input.title.trim(),
      description: input.description ?? null,
      status: (input.status as TaskStatus) ?? "not_started",
      blockedReason: input.blockedReason ?? null,
      isArchived: false,
      createdBy: input.createdBy ?? null,
      assignedTo: input.assignedTo ?? null,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
    })
    .returning();
  return mapTask(row);
}

export async function updateTask(id: number, input: Partial<InsertTask>): Promise<Task> {
  if (input.title !== undefined && !input.title?.trim()) {
    throw new Error("Title is required");
  }
  if (input.status !== undefined && !VALID_STATUSES.includes(input.status as TaskStatus)) {
    throw new Error(`Status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  // Fetch current task to validate blocked reason merge
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) throw new Error("Task not found");

  if (input.status === "blocked") {
    const reason = input.blockedReason !== undefined ? input.blockedReason : existing.blockedReason;
    if (!reason?.trim()) {
      throw new Error("Blocked reason is required when status is blocked");
    }
  }

  if (input.projectId != null) {
    const proj = await getProject(input.projectId);
    if (!proj) throw new Error("Project not found");
  }

  // Only validate milestone consistency when projectId or milestoneId is being explicitly changed
  const changingProject = input.projectId !== undefined;
  const changingMilestone = input.milestoneId !== undefined;

  if (changingProject || changingMilestone) {
    const effectiveProjectId = input.projectId !== undefined ? input.projectId : existing.projectId;
    const effectiveMilestoneId = input.milestoneId !== undefined ? input.milestoneId : existing.milestoneId;

    if (effectiveProjectId != null && effectiveMilestoneId == null) {
      throw new Error("A milestone is required when a project is selected");
    }
    if (effectiveMilestoneId != null) {
      const ms = await getMilestone(effectiveMilestoneId);
      if (!ms) throw new Error("Milestone not found");
      if (ms.projectId !== effectiveProjectId) {
        throw new Error("Milestone does not belong to the selected project");
      }
    }
  }

  const set: Partial<typeof tasksTable.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.description !== undefined) set.description = input.description;
  if (input.status !== undefined) {
    set.status = input.status;
    // Clear blocked reason when switching away from blocked
    if (input.status !== "blocked") set.blockedReason = null;
  }
  if (input.blockedReason !== undefined) set.blockedReason = input.blockedReason;
  if (input.assignedTo !== undefined) set.assignedTo = input.assignedTo;
  if (input.projectId !== undefined) set.projectId = input.projectId;
  if (input.milestoneId !== undefined) set.milestoneId = input.milestoneId;

  const [updated] = await db
    .update(tasksTable)
    .set(set)
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");
  return mapTask(updated);
}

export async function archiveTask(id: number): Promise<Task> {
  const [updated] = await db
    .update(tasksTable)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");
  return mapTask(updated);
}

export async function restoreTask(id: number): Promise<Task> {
  const [updated] = await db
    .update(tasksTable)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");
  return mapTask(updated);
}

// ─── Context helpers ──────────────────────────────────────────────────────────

export type TaskCounts = Record<string, number>;

export async function getTaskCounts(): Promise<TaskCounts> {
  const rows = await db.select().from(tasksTable).where(eq(tasksTable.isArchived, false));
  const counts: TaskCounts = { not_started: 0, in_progress: 0, blocked: 0, needs_review: 0, done: 0 };
  for (const t of rows) {
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  return counts;
}

export async function getTasksByStatus(status: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.isArchived, false), eq(tasksTable.status, status)));
  return rows.map(mapTask);
}

export async function searchTasks(query: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.isArchived, false),
        or(
          ilike(tasksTable.title, `%${query}%`),
          ilike(tasksTable.description, `%${query}%`)
        )
      )
    );
  return rows.map(mapTask);
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
    `Task counts (active): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, needs_review=${counts.needs_review}, done=${counts.done}`
  );

  const statusKeywords: { keyword: string; status: string }[] = [
    { keyword: "needs review", status: "needs_review" },
    { keyword: "needs_review", status: "needs_review" },
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
