import type { Project, InsertProject, UpdateProject } from "@shared/schema";

let projectStore: Project[] = [];
let nextId = 1;

export async function listProjects(): Promise<Project[]> {
  return [...projectStore];
}

export async function getProject(id: number): Promise<Project | undefined> {
  return projectStore.find(p => p.id === id);
}

export async function createProject(input: InsertProject): Promise<Project> {
  if (!input.name?.trim()) throw new Error("Name is required");
  const now = new Date().toISOString();
  const project: Project = {
    id: nextId++,
    name: input.name.trim(),
    description: input.description ?? null,
    timeline: input.timeline ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? null,
  };
  projectStore.push(project);
  return project;
}

export async function updateProject(id: number, input: UpdateProject): Promise<Project> {
  const idx = projectStore.findIndex(p => p.id === id);
  if (idx === -1) throw new Error("Project not found");
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");
  const now = new Date().toISOString();
  const updated: Project = { ...projectStore[idx], ...input, updatedAt: now };
  projectStore[idx] = updated;
  return updated;
}
