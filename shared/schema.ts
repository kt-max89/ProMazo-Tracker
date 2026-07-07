import { z } from "zod";

// ─── Domain types ───────────────────────────────────────────────────────────

export type User = {
  id: number;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  displayName: string;
};

export type InsertUser = Omit<User, "id">;

export type Document = {
  id: number;
  title: string;
  filename: string;
  adminOnly: boolean;
  allowedUsers: string[];
  allowedDomain: string | null;
  chunkCount: number;
  uploadedBy: number;
  uploadedAt: string;
};

export type Chunk = {
  id: number;
  documentId: number;
  chunkIndex: number;
  chunkText: string;
  chunkHash: string;
  embedding: number[] | null;
};

export type Citation = {
  id: number;
  userId: number;
  documentId: number;
  chunkId: number;
  query: string;
  createdAt: string;
};

export type ChatSession = {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type InsertChatSession = {
  userId: number;
  title: string;
};

export type ChatMessage = {
  id: number;
  sessionId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type InsertChatMessage = {
  sessionId: number;
  role: "user" | "assistant";
  content: string;
};

export type Project = {
  id: number;
  name: string;
  description: string | null;
  timeline: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
};

export type InsertProject = {
  name: string;
  description?: string | null;
  timeline?: string | null;
  createdBy?: number | null;
};

export type UpdateProject = Partial<Omit<InsertProject, "createdBy">>;

export type Milestone = {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  timeline: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertMilestone = {
  projectId: number;
  name: string;
  description?: string | null;
  timeline?: string | null;
};

export type UpdateMilestone = Partial<Omit<InsertMilestone, "projectId">>;

export type Task = {
  id: number;
  title: string;
  description: string | null;
  status: "not_started" | "in_progress" | "blocked" | "done";
  blockedReason: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  archivedAt: string | null;
  assignedTo: number | null;
  projectId: number | null;
  milestoneId: number | null;
};

export type InsertTask = {
  title: string;
  description?: string | null;
  status?: "not_started" | "in_progress" | "blocked" | "done";
  blockedReason?: string | null;
  createdBy?: number | null;
  assignedTo?: number | null;
  projectId?: number | null;
  milestoneId?: number | null;
};

export type UpdateTask = Partial<Omit<InsertTask, "createdBy">>;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1, "Display name is required"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const insertProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  createdBy: z.number().nullable().optional(),
});

export const updateProjectSchema = insertProjectSchema.partial().omit({ createdBy: true });

export const insertMilestoneSchema = z.object({
  projectId: z.number(),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
});

export const updateMilestoneSchema = insertMilestoneSchema.partial().omit({ projectId: true });

export const insertTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "done"]).optional(),
  blockedReason: z.string().nullable().optional(),
  createdBy: z.number().nullable().optional(),
  assignedTo: z.number().nullable().optional(),
  projectId: z.number().nullable().optional(),
  milestoneId: z.number().nullable().optional(),
});

export const updateTaskSchema = insertTaskSchema.partial().omit({ createdBy: true });

export const insertDocumentSchema = z.object({
  title: z.string().min(1),
  filename: z.string().min(1),
  adminOnly: z.boolean().optional(),
  allowedUsers: z.array(z.string()).optional(),
  allowedDomain: z.string().nullable().optional(),
});
