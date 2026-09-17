import { queryTasks, type TaskCounts, type TaskFilters } from "./taskService";
import { listProjects } from "./projectService";
import { listMilestones } from "./milestoneService";
import type { Task } from "@shared/schema";
import type { SeeTasksArgs } from "./toolIntentSelector";
import { db } from "./db";
import { sprintsTable, usersTable } from "./schema";
import { getTrackerSettings } from "./sprintService";
import { inArray } from "drizzle-orm";

export type CompactTask = {
  id: number;
  title: string;
  status: string;
  description?: string | null;
  isBlocked?: boolean;
  blockedReason?: string | null;
  projectName?: string | null;
  milestoneName?: string | null;
  assigneeNames?: string[];
};

export type SeeTasksResult = {
  counts: TaskCounts;
  tasks: CompactTask[];
  isEmpty: boolean;
  content: string;
  suggestRetry?: string;
};

async function enrichTasks(tasks: Task[]): Promise<CompactTask[]> {
  if (tasks.length === 0) return [];

  // Batch-fetch all projects, milestones, and users referenced by these tasks
  const projectIds = Array.from(new Set(tasks.map((t) => t.projectId).filter((id): id is number => id != null)));
  const milestoneIds = Array.from(new Set(tasks.map((t) => t.milestoneId).filter((id): id is number => id != null)));
  const assigneeIds = Array.from(new Set(tasks.flatMap((t) => t.assigneeIds)));

  const [allProjects, allMilestones, allUsers] = await Promise.all([
    projectIds.length > 0 ? listProjects() : Promise.resolve([]),
    milestoneIds.length > 0 ? listMilestones() : Promise.resolve([]),
    assigneeIds.length > 0
      ? db.select({ id: usersTable.id, displayName: usersTable.displayName })
          .from(usersTable)
          .where(inArray(usersTable.id, assigneeIds))
      : Promise.resolve([]),
  ]);

  const projectMap = new Map(allProjects.map((p) => [p.id, p.name]));
  const milestoneMap = new Map(allMilestones.map((m) => [m.id, m.name]));
  const userMap = new Map(allUsers.map((u) => [u.id, u.displayName]));

  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    description: t.description ? t.description.slice(0, 120) : null,
    isBlocked: t.isBlocked,
    blockedReason: t.blockedReason ?? null,
    projectName: t.projectId != null ? (projectMap.get(t.projectId) ?? null) : null,
    milestoneName: t.milestoneId != null ? (milestoneMap.get(t.milestoneId) ?? null) : null,
    assigneeNames: t.assigneeIds.map((id) => userMap.get(id) ?? `User #${id}`),
  }));
}

function formatCompact(t: CompactTask): string {
  let line = `- [${t.status}] ${t.title}`;
  if (t.projectName) line += ` | Project: ${t.projectName}`;
  if (t.milestoneName) line += ` | Milestone: ${t.milestoneName}`;
  if (t.assigneeNames && t.assigneeNames.length > 0) line += ` | Assigned to: ${t.assigneeNames.join(", ")}`;
  if (t.isBlocked) line += ` — BLOCKED${t.blockedReason ? `: ${t.blockedReason}` : ""}`;
  if (t.description) line += `\n  ${t.description}`;
  return line;
}

export async function runSeeTasksTool(args: SeeTasksArgs): Promise<SeeTasksResult> {
  const limit = Math.min(Math.max(1, args.limit ?? 10), 20);
  const [allProjects, allMilestones, users, sprintRows, settings] = await Promise.all([
    args.project ? listProjects() : Promise.resolve([]),
    args.milestone ? listMilestones() : Promise.resolve([]),
    args.person
      ? db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable)
      : Promise.resolve([]),
    args.sprintNumber != null
      ? db.select({ id: sprintsTable.id, number: sprintsTable.number }).from(sprintsTable)
      : Promise.resolve([]),
    args.currentSprint ? getTrackerSettings() : Promise.resolve(undefined),
  ]);

  const filters: TaskFilters = {
    archived: false,
    query: args.query,
    status: args.status,
    isBlocked: args.isBlocked,
  };
  if (args.project) {
    filters.projectIds = matchingIds(allProjects, args.project);
  }
  if (args.milestone) {
    filters.milestoneIds = matchingIds(allMilestones, args.milestone);
  }
  if (args.person) {
    filters.assigneeIds = matchingIds(users, args.person, "displayName");
  }

  const requestedSprintIds: number[] = [];
  if (args.sprintNumber != null) {
    requestedSprintIds.push(...sprintRows.filter(s => s.number === args.sprintNumber).map(s => s.id));
  }
  if (args.currentSprint) {
    if (settings?.currentSprintId == null) {
      filters.sprintIds = [];
    } else if (args.sprintNumber != null) {
      filters.sprintIds = requestedSprintIds.includes(settings.currentSprintId)
        ? [settings.currentSprintId]
        : [];
    } else {
      filters.sprintIds = [settings.currentSprintId];
    }
  } else if (args.sprintNumber != null) {
    filters.sprintIds = requestedSprintIds;
  }

  const matched = await queryTasks(filters);
  const counts: TaskCounts = { not_started: 0, in_progress: 0, needs_review: 0, done: 0 };
  for (const task of matched) counts[task.status] = (counts[task.status] ?? 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const filterDescription = describeFilters(args);
  const summaryLine = `Task counts (${filterDescription}): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, needs_review=${counts.needs_review}, done=${counts.done}`;

  if (args.mode === "summary") {
    const isEmpty = total === 0;
    return {
      counts,
      tasks: [],
      isEmpty,
      content: summaryLine,
      suggestRetry: isEmpty
        ? "The task board appears to be empty. Should we try a different search?"
        : undefined,
    };
  }

  const compactTasks = await enrichTasks(matched.slice(0, limit));

  const parts: string[] = [summaryLine];

  if (compactTasks.length > 0) {
    const label = `\nMatching tasks (${filterDescription}):`;
    parts.push(label);
    compactTasks.forEach((t) => parts.push(formatCompact(t)));
  }

  const isEmpty = compactTasks.length === 0;
  const content = parts.join("\n");

  return {
    counts,
    tasks: compactTasks,
    isEmpty,
    content,
    suggestRetry: isEmpty
      ? `No tasks matched these filters: ${filterDescription}. Should we remove one filter or try a broader search?`
      : undefined,
  };
}

function matchingIds<T extends { id: number; name?: string; displayName?: string }>(
  rows: T[],
  query: string,
  field: "name" | "displayName" = "name",
): number[] {
  const normalized = query.trim().toLowerCase();
  return rows
    .filter(row => (row[field] ?? "").toLowerCase().includes(normalized))
    .map(row => row.id);
}

function describeFilters(args: SeeTasksArgs): string {
  const filters = [
    args.status ? `status=${args.status}` : "",
    args.isBlocked !== undefined ? `blocked=${args.isBlocked}` : "",
    args.person ? `person="${args.person}"` : "",
    args.project ? `project="${args.project}"` : "",
    args.milestone ? `milestone="${args.milestone}"` : "",
    args.currentSprint ? "current sprint" : args.sprintNumber ? `sprint ${args.sprintNumber}` : "",
    args.query ? `text="${args.query}"` : "",
  ].filter(Boolean);
  return filters.length > 0 ? `active tasks; ${filters.join(", ")}` : "all active tasks";
}
