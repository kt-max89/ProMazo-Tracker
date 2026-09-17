import { eq, and, or, ilike, inArray, type SQL } from "drizzle-orm";
import { db } from "./db";
import { tasksTable, taskAssigneesTable } from "./schema";
import { taskStatuses, type Task, type InsertTask, type TaskStatus } from "@shared/schema";
import { getProject } from "./projectService";
import { getMilestone } from "./milestoneService";
import { getSprint, getTrackerSettings } from "./sprintService";

export type TaskFilters = {
  archived?: boolean;
  query?: string;
  status?: TaskStatus;
  isBlocked?: boolean;
  projectIds?: number[];
  milestoneIds?: number[];
  sprintIds?: number[];
  assigneeIds?: number[];
};

const VALID_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;
type TaskSize = (typeof VALID_SIZES)[number];

// ─── Row mapper ───────────────────────────────────────────────────────────────

function mapTask(row: typeof tasksTable.$inferSelect, assigneeIds: number[] = []): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status as Task["status"],
    isBlocked: row.isBlocked,
    blockedReason: row.blockedReason,
    size: (row.size as Task["size"]) ?? null,
    isArchived: row.isArchived,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    createdBy: row.createdBy,
    archivedAt: row.archivedAt
      ? (row.archivedAt instanceof Date ? row.archivedAt.toISOString() : String(row.archivedAt))
      : null,
    dueDate: row.dueDate ?? null,
    assigneeIds,
    projectId: row.projectId,
    milestoneId: row.milestoneId ?? null,
    sprintId: row.sprintId ?? null,
  };
}

// ─── Assignee helpers ───────────────────────────────────────────────────────────

async function getAssigneeIdsMap(taskIds: number[]): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (taskIds.length === 0) return map;
  const rows = await db
    .select()
    .from(taskAssigneesTable)
    .where(inArray(taskAssigneesTable.taskId, taskIds));
  for (const row of rows) {
    const list = map.get(row.taskId) ?? [];
    list.push(row.userId);
    map.set(row.taskId, list);
  }
  return map;
}

async function getAssigneeIds(taskId: number): Promise<number[]> {
  const map = await getAssigneeIdsMap([taskId]);
  return map.get(taskId) ?? [];
}

async function setAssignees(taskId: number, assigneeIds: number[]): Promise<void> {
  await db.delete(taskAssigneesTable).where(eq(taskAssigneesTable.taskId, taskId));
  const unique = Array.from(new Set(assigneeIds));
  if (unique.length > 0) {
    await db.insert(taskAssigneesTable).values(unique.map((userId) => ({ taskId, userId })));
  }
}

async function mapTasksWithAssignees(rows: (typeof tasksTable.$inferSelect)[]): Promise<Task[]> {
  const map = await getAssigneeIdsMap(rows.map((r) => r.id));
  return rows.map((row) => mapTask(row, map.get(row.id) ?? []));
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listTasks(filters: TaskFilters = {}): Promise<Task[]> {
  return queryTasks(filters);
}

/**
 * Applies every supplied task filter as an intersection. Keeping this query in
 * the service layer prevents chat-specific lookup rules from changing the
 * behavior of the board's existing CRUD methods.
 */
export async function queryTasks(filters: TaskFilters = {}): Promise<Task[]> {
  const conditions: SQL[] = [
    eq(tasksTable.isArchived, filters.archived ?? false),
  ];

  if (filters.status) conditions.push(eq(tasksTable.status, filters.status));
  if (filters.isBlocked !== undefined) {
    conditions.push(eq(tasksTable.isBlocked, filters.isBlocked));
  }
  if (filters.query?.trim()) {
    const query = `%${filters.query.trim()}%`;
    conditions.push(
      or(
        ilike(tasksTable.title, query),
        ilike(tasksTable.description, query),
      )!,
    );
  }
  if (filters.projectIds) {
    if (filters.projectIds.length === 0) return [];
    conditions.push(inArray(tasksTable.projectId, filters.projectIds));
  }
  if (filters.milestoneIds) {
    if (filters.milestoneIds.length === 0) return [];
    conditions.push(inArray(tasksTable.milestoneId, filters.milestoneIds));
  }
  if (filters.sprintIds) {
    if (filters.sprintIds.length === 0) return [];
    conditions.push(inArray(tasksTable.sprintId, filters.sprintIds));
  }
  if (filters.assigneeIds) {
    if (filters.assigneeIds.length === 0) return [];
    const assignedRows = await db
      .select({ taskId: taskAssigneesTable.taskId })
      .from(taskAssigneesTable)
      .where(inArray(taskAssigneesTable.userId, filters.assigneeIds));
    const assignedTaskIds = Array.from(new Set(assignedRows.map(row => row.taskId)));
    if (assignedTaskIds.length === 0) return [];
    conditions.push(inArray(tasksTable.id, assignedTaskIds));
  }

  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions));
  return mapTasksWithAssignees(rows);
}

export async function getTask(id: number): Promise<Task | undefined> {
  const [row] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!row) return undefined;
  return mapTask(row, await getAssigneeIds(id));
}

export async function createTask(input: InsertTask): Promise<Task> {
  if (!input.title?.trim()) {
    throw new Error("Title is required");
  }
  if (input.status && !taskStatuses.includes(input.status as TaskStatus)) {
    throw new Error(`Status must be one of: ${taskStatuses.join(", ")}`);
  }
  if (input.isBlocked && !input.blockedReason?.trim()) {
    throw new Error("Blocked reason is required when a task is marked as blocked");
  }
  if (input.size != null && !VALID_SIZES.includes(input.size as TaskSize)) {
    throw new Error(`Size must be one of: ${VALID_SIZES.join(", ")}`);
  }
  if (input.projectId != null) {
    const proj = await getProject(input.projectId);
    if (!proj) throw new Error("Project not found");
  }
  const sprintId = input.sprintId === undefined
    ? (await getTrackerSettings()).currentSprintId
    : input.sprintId;
  if (sprintId != null && !(await getSprint(sprintId))) {
    throw new Error("Sprint not found");
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
      isBlocked: input.isBlocked ?? false,
      blockedReason: input.isBlocked ? (input.blockedReason ?? null) : null,
      size: input.size ?? null,
      isArchived: false,
      createdBy: input.createdBy ?? null,
      dueDate: input.dueDate ?? null,
      projectId: input.projectId ?? null,
      milestoneId: input.milestoneId ?? null,
      sprintId,
    })
    .returning();

  if (input.assigneeIds && input.assigneeIds.length > 0) {
    await setAssignees(row.id, input.assigneeIds);
  }
  return mapTask(row, input.assigneeIds ?? []);
}

export async function updateTask(id: number, input: Partial<InsertTask>): Promise<Task> {
  if (input.title !== undefined && !input.title?.trim()) {
    throw new Error("Title is required");
  }
  if (input.status !== undefined && !taskStatuses.includes(input.status as TaskStatus)) {
    throw new Error(`Status must be one of: ${taskStatuses.join(", ")}`);
  }
  if (input.size != null && !VALID_SIZES.includes(input.size as TaskSize)) {
    throw new Error(`Size must be one of: ${VALID_SIZES.join(", ")}`);
  }

  // Fetch current task to validate blocked reason merge
  const [existing] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!existing) throw new Error("Task not found");

  const effectiveIsBlocked = input.isBlocked !== undefined ? input.isBlocked : existing.isBlocked;
  if (effectiveIsBlocked) {
    const reason = input.blockedReason !== undefined ? input.blockedReason : existing.blockedReason;
    if (!reason?.trim()) {
      throw new Error("Blocked reason is required when a task is marked as blocked");
    }
  }

  if (input.projectId != null) {
    const proj = await getProject(input.projectId);
    if (!proj) throw new Error("Project not found");
  }
  if (input.sprintId != null && !(await getSprint(input.sprintId))) {
    throw new Error("Sprint not found");
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
  if (input.status !== undefined) set.status = input.status;
  if (input.isBlocked !== undefined) {
    set.isBlocked = input.isBlocked;
    // Clear blocked reason when toggling off
    if (!input.isBlocked) set.blockedReason = null;
  }
  if (input.blockedReason !== undefined) set.blockedReason = input.blockedReason;
  if (input.size !== undefined) set.size = input.size;
  if (input.dueDate !== undefined) set.dueDate = input.dueDate;
  if (input.projectId !== undefined) set.projectId = input.projectId;
  if (input.milestoneId !== undefined) set.milestoneId = input.milestoneId;
  if (input.sprintId !== undefined) set.sprintId = input.sprintId;

  const [updated] = await db
    .update(tasksTable)
    .set(set)
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");

  let assigneeIds: number[];
  if (input.assigneeIds !== undefined) {
    await setAssignees(id, input.assigneeIds);
    assigneeIds = input.assigneeIds;
  } else {
    assigneeIds = await getAssigneeIds(id);
  }
  return mapTask(updated, assigneeIds);
}

export async function archiveTask(id: number): Promise<Task> {
  const [updated] = await db
    .update(tasksTable)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");
  return mapTask(updated, await getAssigneeIds(id));
}

export async function restoreTask(id: number): Promise<Task> {
  const [updated] = await db
    .update(tasksTable)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(eq(tasksTable.id, id))
    .returning();
  if (!updated) throw new Error("Task not found");
  return mapTask(updated, await getAssigneeIds(id));
}

// ─── Context helpers ──────────────────────────────────────────────────────────

export type TaskCounts = Record<string, number>;

export async function getTaskCounts(): Promise<TaskCounts> {
  const rows = await db.select().from(tasksTable).where(eq(tasksTable.isArchived, false));
  const counts: TaskCounts = { not_started: 0, in_progress: 0, needs_review: 0, done: 0 };
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
  return mapTasksWithAssignees(rows);
}

export async function getBlockedTasks(): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.isArchived, false), eq(tasksTable.isBlocked, true)));
  return mapTasksWithAssignees(rows);
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
  return mapTasksWithAssignees(rows);
}

function formatTaskLine(t: Task): string {
  let line = `- [${t.status}] ${t.title}`;
  if (t.assigneeIds.length > 0) line += ` (assigned to user${t.assigneeIds.length > 1 ? "s" : ""} ${t.assigneeIds.map((id) => `#${id}`).join(", ")})`;
  if (t.isBlocked) line += ` — BLOCKED${t.blockedReason ? `: ${t.blockedReason}` : ""}`;
  return line;
}

export async function getCompactTaskContext(message: string): Promise<string> {
  const lower = message.toLowerCase();
  const parts: string[] = [];

  const counts = await getTaskCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  parts.push(
    `Task counts (active): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, needs_review=${counts.needs_review}, done=${counts.done}`
  );

  if (lower.includes("blocked")) {
    const rows = await db.select().from(tasksTable).where(and(eq(tasksTable.isArchived, false), eq(tasksTable.isBlocked, true)));
    const blockedTasks = await mapTasksWithAssignees(rows);
    if (blockedTasks.length > 0) {
      parts.push("\nBlocked tasks:");
      blockedTasks.slice(0, 10).forEach((t) => parts.push(formatTaskLine(t)));
    } else {
      parts.push("\nBlocked tasks: none");
    }
  }

  const statusKeywords: { keyword: string; status: string }[] = [
    { keyword: "needs review", status: "needs_review" },
    { keyword: "needs_review", status: "needs_review" },
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
