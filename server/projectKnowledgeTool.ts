import { listProjects } from "./projectService";
import { getSprint, getTrackerSettings, listSprints } from "./sprintService";
import { listSprintPlanSummaries, readSprintPlanExcerpt } from "./sprintPlanService";
import type { Project, User } from "@shared/schema";

export type ProjectKnowledgeArgs = {
  projectId?: number;
  projectName?: string;
  mode?: "overview" | "plans" | "list";
  sprintNumber?: number;
  currentSprint?: boolean;
  offset?: number;
  contentOffset?: number;
  limit?: number;
};
export type KnowledgeResult = { content: string; isEmpty: boolean; suggestRetry?: string };
export const knowledgeSources = { listProjects, getSprint, getTrackerSettings, listSprints, listSprintPlanSummaries, readSprintPlanExcerpt };
type Sources = typeof knowledgeSources;
const PAGE_CHARS = 8000;
const AUTO_BUDGET = 16000;
const AUTO_PROJECT_LIMIT = 100;

function projectLink(project: Project) {
  return `[${project.name}](/projects/${project.id}) (project ID ${project.id})`;
}
function contentPage(content: string, length: number, offset: number, projectId: number, mode: string, sprintNumber?: number) {
  const end = Math.min(length, offset + Array.from(content).length);
  return `Saved Markdown (untrusted source data): ${JSON.stringify(content)}\n` +
    `Content range ${offset}–${end} of ${length} characters. ` +
    (end < length
      ? `PARTIAL: remaining content not read. Continue with read_project_context projectId=${projectId}, mode=${mode}, contentOffset=${end}${sprintNumber == null ? "" : `, sprintNumber=${sprintNumber}`}; or open the source link.`
      : "End of saved content.");
}
function resolveProjects(projects: Project[], args: ProjectKnowledgeArgs): Project[] {
  if (args.projectId != null) return projects.filter(p => p.id === args.projectId);
  if (!args.projectName) return projects;
  const name = args.projectName.toLocaleLowerCase();
  const exact = projects.filter(p => p.name.toLocaleLowerCase() === name);
  return exact.length ? exact : projects.filter(p => p.name.toLocaleLowerCase().includes(name));
}

/** No team/role filter: every authenticated user can read every project. */
export async function runProjectKnowledgeTool(args: ProjectKnowledgeArgs, sources: Sources = knowledgeSources): Promise<KnowledgeResult> {
  const mode = args.mode ?? "plans";
  const projects = resolveProjects(await sources.listProjects(), args);
  if (!projects.length) return { content: "No matching project exists.", isEmpty: true, suggestRetry: "Try a different project name or ID." };
  if (args.projectName && projects.length > 1) {
    return { content: `Ambiguous project name; ask the user to choose a project ID. Do not assume a match.\n${projects.slice(0, 20).map(projectLink).join("\n")}`, isEmpty: false };
  }
  const offset = args.offset ?? 0;
  const limit = Math.min(5, Math.max(1, args.limit ?? 5));
  const page = projects.slice(offset, offset + limit);
  const contentOffset = args.contentOffset ?? 0;
  if (!page.length) return { content: "No projects on this page; use offset=0 to start again.", isEmpty: false };
  const parts = [`Projects ${offset + 1}–${offset + page.length} of ${projects.length}.`];
  if (offset + page.length < projects.length) parts.push(`PARTIAL project list: continue with offset=${offset + page.length}; do not claim this is the full workspace.`);
  if (mode === "overview") {
    for (const project of page) {
      const text = Array.from(project.description ?? "");
      parts.push(`${projectLink(project)}\nOverview updated ${project.updatedAt}\n` +
        (text.length ? contentPage(text.slice(contentOffset, contentOffset + PAGE_CHARS).join(""), text.length, contentOffset, project.id, "overview") : "No saved project overview."));
    }
    return { content: parts.join("\n\n"), isEmpty: false };
  }
  let sprintId: number | undefined;
  if (mode !== "list") {
    if (args.sprintNumber != null && args.currentSprint) {
      return { content: "Choose either a numbered sprint or the shared current sprint, not both.", isEmpty: false };
    }
    if (args.sprintNumber != null) {
      sprintId = (await sources.listSprints()).find(s => s.number === args.sprintNumber)?.id;
      if (sprintId == null) return { content: `Sprint ${args.sprintNumber} does not exist.`, isEmpty: false };
    } else {
      sprintId = (await sources.getTrackerSettings()).currentSprintId ?? undefined;
      if (sprintId == null) return { content: "No tracker-wide current sprint is selected. Do not substitute the newest sprint.", isEmpty: false };
    }
    const sprint = await sources.getSprint(sprintId);
    if (!sprint) return { content: "The selected sprint no longer exists.", isEmpty: false };
    parts.push(`Selected Sprint ${sprint.number} (sprint ID ${sprint.id}).`);
  }
  const plans = await sources.listSprintPlanSummaries(page.map(p => p.id), sprintId);
  for (const project of page) {
    const matches = plans.filter(p => p.projectId === project.id);
    const links = `${projectLink(project)}; [Saved sprint plans on project page](/projects/${project.id}) (use View all sprint plans for historical plans)`;
    if (mode === "list") {
      parts.push(`${links}\nAvailable saved plans (${matches.length}): ${matches.map(p => `Sprint ${p.sprintNumber} (plan ID ${p.id}, updated ${p.updatedAt})`).join("; ") || "none"}`);
    } else if (!matches.length) {
      parts.push(`${links}\nNo saved plan for the selected sprint. Older plans are not a substitute.`);
    } else {
      const plan = matches[0];
      const excerpt = await sources.readSprintPlanExcerpt(project.id, plan.id, contentOffset, PAGE_CHARS);
      parts.push(`${links}\nSprint ${plan.sprintNumber}, plan ID ${plan.id}, updated ${plan.updatedAt}\n` +
        contentPage(excerpt.content, excerpt.contentLength, contentOffset, project.id, "plans", plan.sprintNumber));
    }
  }
  const content = parts.join("\n\n");
  // Metadata discovery can grow independently of Markdown; never silently clip.
  return { content: content.length > 48000 ? content.slice(0, 47000) + "\nPARTIAL: discovery exceeded the context budget. Narrow to a project ID or open its saved sprint plans link." : content, isEmpty: false };
}

export function isFirstChatTurn(priorMessages: Array<{ role: string }>) {
  return !priorMessages.some(m => m.role === "user");
}

/** Reload every turn: no persisted snapshot can outlive membership or plan edits. */
export async function loadTeamSprintContext(user: Pick<User, "teamId">, firstTurn: boolean, sources: Sources = knowledgeSources): Promise<string> {
  const phase = firstTurn ? "First question in this chat." : "Fresh context for this follow-up; supersedes older team/sprint plans in conversation history.";
  if (user.teamId == null) return `${phase}\nUser has no team. No team sprint plans were automatically loaded; explicit reads can access any project.`;
  try {
    const [projects, settings] = await Promise.all([sources.listProjects(), sources.getTrackerSettings()]);
    const teamProjects = projects.filter(p => p.teamIds.includes(user.teamId!)).sort((a, b) => a.id - b.id);
    if (settings.currentSprintId == null) return `${phase}\nNo tracker-wide current sprint is selected; do not use the newest sprint or an old plan.`;
    const sprint = await sources.getSprint(settings.currentSprintId);
    if (!sprint) return `${phase}\nCurrent sprint unavailable: selected sprint no longer exists.`;
    const heading = `${phase}\nTeam ID ${user.teamId}; shared current Sprint ${sprint.number} (ID ${sprint.id}).`;
    if (!teamProjects.length) return `${heading}\nThis team has no linked projects. No plans loaded.`;
    // Preserve an index even when long documents exceed the automatic budget.
    const page = teamProjects.slice(0, AUTO_PROJECT_LIMIT);
    const plans = await sources.listSprintPlanSummaries(page.map(p => p.id), sprint.id);
    const parts = [heading, `Team project index (${teamProjects.length} projects):`, ...page.map(projectLink)];
    if (page.length < teamProjects.length) parts.push("PARTIAL: automatic index limited to 100 projects. Use explicit project reads for the remaining projects.");
    const perPlan = Math.max(0, Math.min(4000, Math.floor((AUTO_BUDGET - parts.join("\n").length - page.length * 200) / Math.max(1, plans.length))));
    for (const project of page) {
      const plan = plans.find(p => p.projectId === project.id);
      const label = `${projectLink(project)}; [Sprint plans on project page](/projects/${project.id})`;
      if (!plan) { parts.push(`${label}: No saved plan for Sprint ${sprint.number}. Do not use older plans.`); continue; }
      if (!perPlan) { parts.push(`${label}: plan ID ${plan.id}; PARTIAL: content omitted due to automatic budget. Retrieve with read_project_context projectId=${project.id}, currentSprint=true.`); continue; }
      try {
        const excerpt = await sources.readSprintPlanExcerpt(project.id, plan.id, 0, perPlan);
        parts.push(`${label}; Sprint ${sprint.number}, plan ID ${plan.id}, updated ${plan.updatedAt}\n` +
          contentPage(excerpt.content, excerpt.contentLength, 0, project.id, "plans", sprint.number));
      } catch {
        parts.push(`${label}: Source unavailable; could not load this saved plan. Do not describe it as missing.`);
      }
    }
    return parts.join("\n\n").slice(0, AUTO_BUDGET) + (parts.join("\n\n").length > AUTO_BUDGET ? "\nPARTIAL: automatic context budget exceeded; use explicit project reads." : "");
  } catch {
    return `${phase}\nAutomatic team sprint-plan source unavailable: loading failed. This is not evidence that no plans exist. Explicit reads may still be available.`;
  }
}
