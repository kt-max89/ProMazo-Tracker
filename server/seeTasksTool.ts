import {
  getTaskCounts,
  getTasksByStatus,
  getBlockedTasks,
  searchTasks,
  listTasks,
  type TaskCounts,
} from "./taskService";
import { listProjects } from "./projectService";
import { listMilestones } from "./milestoneService";
import type { Task } from "@shared/schema";
import type { SeeTasksArgs } from "./toolIntentSelector";
import { db } from "./db";
import { usersTable } from "./schema";
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

  const counts = await getTaskCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const summaryLine = `Task counts (active): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, needs_review=${counts.needs_review}, done=${counts.done}`;

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

  let matched: Task[] = [];

  if (args.isBlocked) {
    matched = await getBlockedTasks();
  } else if (args.status) {
    matched = await getTasksByStatus(args.status);
  } else if (args.query) {
    matched = await searchTasks(args.query);
  } else {
    matched = await listTasks({ archived: false });
  }

  matched = matched.slice(0, limit);
  const compactTasks = await enrichTasks(matched);

  const parts: string[] = [summaryLine];

  if (compactTasks.length > 0) {
    const label = args.isBlocked
      ? "\nBlocked tasks:"
      : args.status
      ? `\n${args.status} tasks:`
      : args.query
      ? `\nTasks matching "${args.query}":`
      : "\nAll active tasks:";
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
      ? args.isBlocked
        ? "No blocked tasks were found. Should we try a broader search?"
        : args.status
        ? `No tasks with status "${args.status}" were found. Should we try a different status or a broader search?`
        : args.query
        ? `No tasks matching "${args.query}" were found. Should we try a different keyword?`
        : "The task board appears empty. Should we check archived tasks or try a different search?"
      : undefined,
  };
}
