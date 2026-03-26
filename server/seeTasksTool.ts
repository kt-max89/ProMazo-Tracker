import {
  getTaskCounts,
  getTasksByStatus,
  searchTasks,
  listTasks,
  type TaskCounts,
} from "./taskService";
import type { Task } from "@shared/schema";
import type { SeeTasksArgs } from "./toolIntentSelector";

export type CompactTask = {
  id: number;
  title: string;
  status: string;
  description?: string | null;
  blockedReason?: string | null;
};

export type SeeTasksResult = {
  counts: TaskCounts;
  tasks: CompactTask[];
  isEmpty: boolean;
  content: string;
  suggestRetry?: string;
};

function toCompact(t: Task): CompactTask {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    description: t.description ? t.description.slice(0, 120) : null,
    blockedReason: t.blockedReason ?? null,
  };
}

function formatCompact(t: CompactTask): string {
  let line = `- [${t.status}] ${t.title}`;
  if (t.status === "blocked" && t.blockedReason) line += ` — blocked: ${t.blockedReason}`;
  if (t.description) line += `\n  ${t.description}`;
  return line;
}

export async function runSeeTasksTool(args: SeeTasksArgs): Promise<SeeTasksResult> {
  const limit = Math.min(Math.max(1, args.limit ?? 10), 20);

  const counts = await getTaskCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const summaryLine = `Task counts (active): total=${total}, not_started=${counts.not_started}, in_progress=${counts.in_progress}, blocked=${counts.blocked}, done=${counts.done}`;

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

  if (args.status) {
    matched = await getTasksByStatus(args.status);
  } else if (args.query) {
    matched = await searchTasks(args.query);
  } else {
    matched = await listTasks({ archived: false });
  }

  matched = matched.slice(0, limit);
  const compactTasks = matched.map(toCompact);

  const parts: string[] = [summaryLine];

  if (compactTasks.length > 0) {
    const label = args.status
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
      ? args.status
        ? `No tasks with status "${args.status}" were found. Should we try a different status or a broader search?`
        : args.query
        ? `No tasks matching "${args.query}" were found. Should we try a different keyword?`
        : "The task board appears empty. Should we check archived tasks or try a different search?"
      : undefined,
  };
}
