import { listProjects } from "./projectService";
import { listMilestones } from "./milestoneService";
import { listTasks } from "./taskService";
import type { Project } from "@shared/schema";

export type SeeProjectsArgs = {
  projectId?: number;
  query?: string;
  limit?: number;
};

export type SeeProjectsResult = {
  content: string;
  isEmpty: boolean;
  suggestRetry?: string;
};

export async function runSeeProjectsTool(args: SeeProjectsArgs): Promise<SeeProjectsResult> {
  const [allProjects, allMilestones, allTasks] = await Promise.all([
    listProjects(),
    listMilestones(),
    listTasks({ archived: false }),
  ]);

  // Filter by projectId if provided
  let projects: Project[];
  projects = allProjects;
  if (args.projectId != null) {
    projects = projects.filter((p) => p.id === args.projectId);
  }
  if (args.query) {
    const q = args.query.toLowerCase();
    projects = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q)
    );
  }
  if (args.limit != null) {
    projects = projects.slice(0, Math.min(Math.max(1, args.limit), 10));
  }

  if (projects.length === 0) {
    const isEmpty = true;
    const suggestRetry = args.query
      ? `No projects matching "${args.query}" were found. Should we try a different search?`
      : args.projectId != null
      ? `Project #${args.projectId} was not found. Should we list all projects instead?`
      : "No projects exist yet. Would you like to create one?";
    return { content: "No projects found.", isEmpty, suggestRetry };
  }

  // Group the already-batched active tasks and milestones by project.
  const tasksByProject = new Map<number, { not_started: number; in_progress: number; needs_review: number; done: number }>();
  for (const t of allTasks) {
    if (t.projectId == null) continue;
    const entry = tasksByProject.get(t.projectId) ?? { not_started: 0, in_progress: 0, needs_review: 0, done: 0 };
    const s = t.status as keyof typeof entry;
    if (s in entry) entry[s]++;
    tasksByProject.set(t.projectId, entry);
  }
  const milestonesByProject = new Map<number, typeof allMilestones>();
  for (const milestone of allMilestones) {
    const group = milestonesByProject.get(milestone.projectId) ?? [];
    group.push(milestone);
    milestonesByProject.set(milestone.projectId, group);
  }

  const parts: string[] = [`Projects (${projects.length} total):\n`];

  for (const project of projects) {
    const milestones = milestonesByProject.get(project.id) ?? [];
    const counts = tasksByProject.get(project.id) ?? { not_started: 0, in_progress: 0, needs_review: 0, done: 0 };
    const totalTasks = Object.values(counts).reduce((a, b) => a + b, 0);

    parts.push(`### ${project.name}`);
    if (project.description) parts.push(`Description: ${project.description}`);
    if (project.timeline) parts.push(`Timeline: ${project.timeline}`);
    parts.push(
      `Tasks: ${totalTasks} total (not_started=${counts.not_started}, in_progress=${counts.in_progress}, needs_review=${counts.needs_review}, done=${counts.done})`
    );

    if (milestones.length > 0) {
      parts.push(`Milestones (${milestones.length}):`);
      for (const ms of milestones) {
        let msLine = `  - ${ms.name}`;
        if (ms.timeline) msLine += ` [${ms.timeline}]`;
        if (ms.description) msLine += ` — ${ms.description}`;
        parts.push(msLine);
      }
    } else {
      parts.push("Milestones: none");
    }

    parts.push(""); // blank line between projects
  }

  return {
    content: parts.join("\n"),
    isEmpty: false,
  };
}
