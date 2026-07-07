import type { Project, InsertProject, UpdateProject } from "@shared/schema";
import { loadStore, saveStore } from "./persist";

type ProjectStore = { projects: Project[]; nextId: number };

function load(): ProjectStore {
  return loadStore<ProjectStore>("projects", { projects: [], nextId: 1 });
}

function save(store: ProjectStore): void {
  saveStore("projects", store);
}

export async function listProjects(): Promise<Project[]> {
  return [...load().projects];
}

export async function getProject(id: number): Promise<Project | undefined> {
  return load().projects.find(p => p.id === id);
}

export async function createProject(input: InsertProject): Promise<Project> {
  if (!input.name?.trim()) throw new Error("Name is required");
  const store = load();
  const now = new Date().toISOString();
  const project: Project = {
    id: store.nextId++,
    name: input.name.trim(),
    description: input.description ?? null,
    timeline: input.timeline ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy ?? null,
  };
  store.projects.push(project);
  save(store);
  return project;
}

export async function updateProject(id: number, input: UpdateProject): Promise<Project> {
  const store = load();
  const idx = store.projects.findIndex(p => p.id === id);
  if (idx === -1) throw new Error("Project not found");
  if (input.name !== undefined && !input.name?.trim()) throw new Error("Name is required");
  const now = new Date().toISOString();
  const updated: Project = { ...store.projects[idx], ...input, updatedAt: now };
  store.projects[idx] = updated;
  save(store);
  return updated;
}

export async function deleteProject(id: number): Promise<void> {
  const store = load();
  store.projects = store.projects.filter(p => p.id !== id);
  save(store);
}
