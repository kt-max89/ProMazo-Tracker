import { randomUUID } from "crypto";
import { getTask, queryTasks, updateTask } from "./taskService";
import { listProjects, getProject } from "./projectService";
import { listMilestones, getMilestone } from "./milestoneService";
import { listSprints, getSprint } from "./sprintService";
import { liveCoordinator } from "./live";
import type { IStorage } from "./storage";
import type { Task } from "@shared/schema";
import { effectiveTaskEditChanges, modelTaskEditSchema, reviewedTaskEditSchema, type TaskEditChanges, type TaskEditProposal, type TaskEditField } from "@shared/taskEdits";

export type TaskEditLookup = {
  taskId?: number; taskName?: string; fields?: TaskEditField[];
  references?: { projectName?: string; projectId?: number; milestoneName?: string; milestoneId?: number; assigneeNames?: string[]; assigneeIds?: number[]; assigneeMode?: "replace" | "add" | "remove"; sprintNumber?: number; sprintId?: number };
};
type ResolvedEditReferences = { projectId?: number; milestoneId?: number; sprintId?: number; assigneeIds?: number[] };
export type TaskEditContext = { task?: Task; content: string; fields?: TaskEditField[]; references?: ResolvedEditReferences };

export function uniqueEditReference<T extends { id: number; name: string }>(rows: T[], name: string, label: string): T {
  const normalized = name.trim().toLowerCase();
  const exact = rows.filter(row => row.name.toLowerCase() === normalized);
  const matches = exact.length ? exact : rows.filter(row => row.name.toLowerCase().includes(normalized));
  if (matches.length !== 1) throw new Error(matches.length
    ? `${label} "${name}" is ambiguous. Choose an ID: ${matches.map(row => `#${row.id} ${row.name}`).join(", ")}`
    : `${label} "${name}" was not found. Provide an existing name or ID.`);
  return matches[0];
}

export async function prepareTaskEdit(args: TaskEditLookup, storage: IStorage, actorId?: number): Promise<TaskEditContext> {
  let task: Task | undefined;
  if (args.taskId) {
    task = await getTask(args.taskId);
  } else if (args.taskName?.trim()) {
    const candidates = await queryTasks({ query: args.taskName.trim() });
    // Never infer uniqueness from the first page, nor privilege an exact title
    // over another live task matching the supplied context.
    if (candidates.length !== 1) return {
      content: candidates.length === 0
        ? "Task not found. Ask for its ID or a more precise name. Do not create a replacement."
        : `Ambiguous task. Ask the user to choose an ID. Matches (${candidates.length} total): ${JSON.stringify(candidates.slice(0, 20).map(t => ({ id: t.id, title: t.title })))}. No edit is authorized.`,
    };
    task = candidates[0];
  }
  if (!task || task.isArchived) return { content: "No active target task identified. Ask for the task ID or name; do not create a replacement." };
  const [projects, milestones, sprints, users] = await Promise.all([
    listProjects(), listMilestones(), listSprints(), storage.getAllUsers(),
  ]);
  const refs = args.references;
  const resolvedReferences: ResolvedEditReferences = {};
  try {
    const requestedProject = refs?.projectName
      ? uniqueEditReference(projects, refs.projectName, "Project").id : refs?.projectId;
    if (requestedProject !== undefined) resolvedReferences.projectId = requestedProject;
    if (refs?.milestoneName) resolvedReferences.milestoneId = uniqueEditReference(
      milestones.filter(m => m.projectId === (requestedProject ?? task!.projectId)),
      refs.milestoneName, "Milestone").id;
    else if (refs?.milestoneId !== undefined) resolvedReferences.milestoneId = refs.milestoneId;
    if (refs?.assigneeIds) resolvedReferences.assigneeIds = refs.assigneeIds;
    if (refs?.assigneeNames) resolvedReferences.assigneeIds = Array.from(new Set([
      ...(refs.assigneeIds ?? []),
      ...refs.assigneeNames.map(name =>
        /^(me|myself)$/i.test(name) && actorId ? actorId : uniqueEditReference(
          users.map(u => ({ id: u.id, name: u.displayName })), name, "Assignee").id),
    ]));
    if (resolvedReferences.assigneeIds !== undefined) {
      const requested = resolvedReferences.assigneeIds;
      resolvedReferences.assigneeIds = refs?.assigneeMode === "add"
        ? Array.from(new Set([...task.assigneeIds, ...requested]))
        : refs?.assigneeMode === "remove"
          ? task.assigneeIds.filter(id => !requested.includes(id))
          : requested;
    }
    if (refs?.sprintId !== undefined) resolvedReferences.sprintId = refs.sprintId;
    if (refs?.sprintNumber !== undefined) {
      const matches = sprints.filter(s => s.number === refs.sprintNumber);
      if (matches.length !== 1) throw new Error(`Sprint ${refs.sprintNumber} is ${matches.length ? "ambiguous; choose its ID" : "not available; choose an existing sprint or Backlog"}.`);
      resolvedReferences.sprintId = matches[0].id;
    }
  } catch (error) {
    return { content: `Task #${task.id} was found, but its requested reference needs clarification: ${error instanceof Error ? error.message : "Choose exact reference IDs"}. Do not emit any proposal.` };
  }
  const fields = args.fields === undefined ? undefined : Array.from(new Set([
    ...args.fields,
    ...(args.fields.includes("isBlocked") ? ["blockedReason" as const] : []),
    ...(args.fields.includes("projectId") ? ["milestoneId" as const] : []),
  ]));
  return { task, fields, references: resolvedReferences, content: JSON.stringify({
    requestedFieldsForThisTurn: fields,
    signedInUserId: actorId,
    resolvedRequestedReferences: resolvedReferences,
    task,
    projects: projects.map(p => ({ id: p.id, name: p.name })),
    milestones: milestones.map(m => ({ id: m.id, projectId: m.projectId, name: m.name })),
    sprints: sprints.map(s => ({ id: s.id, number: s.number })),
    users: users.map(u => ({ id: u.id, displayName: u.displayName, isActive: u.isActive })),
  }) };
}

export async function validateTaskEditReferences(task: Task, changes: TaskEditChanges, storage: IStorage): Promise<void> {
  if (task.isArchived) throw new Error("This task is archived. Restore it manually before editing.");
  const isBlocked = changes.isBlocked ?? task.isBlocked;
  const reason = changes.blockedReason === undefined ? task.blockedReason : changes.blockedReason;
  if (isBlocked && !reason?.trim()) throw new Error("Add a blocked reason before marking this task as blocked.");
  if (!isBlocked && changes.blockedReason != null && changes.blockedReason.trim()) {
    throw new Error("Mark the task as blocked to set a blocked reason, or clear the reason.");
  }
  if (changes.assigneeIds) {
    const users = await storage.getAllUsers();
    for (const id of changes.assigneeIds) {
      const user = users.find(u => u.id === id);
      if (!user || (!user.isActive && !task.assigneeIds.includes(id))) {
        throw new Error(`Assignee #${id} is unavailable. Select an active user or remove this assignment.`);
      }
    }
  }
  if (changes.projectId !== undefined || changes.milestoneId !== undefined) {
    const projectId = changes.projectId === undefined ? task.projectId : changes.projectId;
    const milestoneId = changes.milestoneId === undefined ? task.milestoneId : changes.milestoneId;
    if (projectId != null && !(await getProject(projectId))) throw new Error("Project not found. Choose an existing project.");
    if (projectId != null && milestoneId == null) throw new Error("Select a milestone for the chosen project.");
    if (milestoneId != null) {
      const milestone = await getMilestone(milestoneId);
      if (!milestone || milestone.projectId !== projectId) throw new Error("Select a milestone belonging to the chosen project, or clear both project and milestone.");
    }
  }
  if (changes.sprintId != null && !(await getSprint(changes.sprintId))) throw new Error("Sprint not found. Choose an existing sprint or Backlog.");
}

export async function buildTaskEditProposal(raw: unknown, context: TaskEditContext | undefined, storage: IStorage): Promise<TaskEditProposal | null> {
  const parsed = modelTaskEditSchema.safeParse(raw);
  if (!parsed.success || !context?.task || parsed.data.taskId !== context.task.id) return null;
  if (context.fields && Object.keys(parsed.data.changes).some(field => !context.fields!.includes(field as TaskEditField))) {
    throw new Error("The proposal included fields outside your latest request. Please state only the changes you want in this edit.");
  }
  const bindings = context.references;
  for (const field of ["projectId", "milestoneId", "sprintId"] as const) {
    if (bindings?.[field] !== undefined &&
      (parsed.data.changes[field] !== undefined || context.fields?.includes(field)) &&
      parsed.data.changes[field] !== bindings[field]) {
      throw new Error(`The proposed ${field.replace("Id", "")} does not match your request. Please specify the intended reference again.`);
    }
  }
  if (bindings?.assigneeIds !== undefined) {
    const actual = parsed.data.changes.assigneeIds;
    const expected = [...bindings.assigneeIds].sort((a, b) => a - b);
    if (!actual || JSON.stringify([...actual].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
      throw new Error("The proposed assignees do not match your request. Please specify who to assign, add, or remove.");
    }
  }
  const changes = effectiveTaskEditChanges(parsed.data.changes);
  await validateTaskEditReferences(context.task, changes, storage);
  return { ...parsed.data, changes, currentTask: context.task, proposalId: randomUUID() };
}

export async function approveTaskEdit(raw: unknown, actorId: number, storage: IStorage): Promise<Task> {
  const parsed = reviewedTaskEditSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Review the proposed edit: ${parsed.error.issues[0].message}`);
  const task = await getTask(parsed.data.taskId);
  if (!task) throw new Error("Task not found. It may have been removed; identify an existing task.");
  await validateTaskEditReferences(task, parsed.data.changes, storage);
  const saved = await updateTask(task.id, parsed.data.changes, actorId);
  await liveCoordinator.publish("tasks");
  return saved;
}
