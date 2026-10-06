import { z } from "zod";

// ─── Domain types ───────────────────────────────────────────────────────────

export type User = {
  id: number;
  email: string;
  passwordHash: string;
  role: "admin" | "user";
  displayName: string;
  teamId: number | null;
  isActive: boolean;
  authVersion: number;
};

export type InsertUser = Omit<User, "id" | "teamId" | "isActive" | "authVersion">;
export type ManagedUser = Omit<User, "passwordHash" | "authVersion">;

export const userAccessActionSchema = z.object({
  action: z.enum(["promote", "demote", "deactivate", "reactivate"]),
}).strict();
export type UserAccessAction = z.infer<typeof userAccessActionSchema>["action"];

export type Team = { id: number; name: string; socialContract: string; createdAt: string };

export const updateTeamSchema = z.object({
  socialContract: z.string().max(100_000, "Social Contract is too long"),
}).strict();

export const insertTeamSchema = z.object({
  name: z.string().trim().min(1, "Team name is required"),
  projectIds: z.array(z.number().int().positive()).default([]),
});

export const teamMembershipSchema = z.object({
  teamId: z.number().int().positive().nullable(),
});

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
  teamId: number | null;
  teamIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type InsertProject = {
  name: string;
  description?: string | null;
  timeline?: string | null;
  teamId?: number | null;
  teamIds?: number[];
};

export type UpdateProject = Partial<InsertProject>;

export type Milestone = {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  timeline: string | null;
  excludedSprintIds: number[];
  sprintIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type InsertMilestone = {
  projectId: number;
  name: string;
  description?: string | null;
  timeline?: string | null;
  excludedSprintIds?: number[];
};

export type UpdateMilestone = Partial<Omit<InsertMilestone, "projectId">>;

export type Sprint = {
  id: number;
  number: number;
  createdAt: string;
};

export type TrackerSettings = {
  currentSprintId: number | null;
};

export type ProjectSprintPlan = {
  id: number;
  projectId: number;
  sprintId: number;
  sprintNumber: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export const createSprintPlanSchema = z.object({
  sprintId: z.number().int().positive(),
  content: z.string().max(100_000, "Sprint plan is too long"),
}).strict();

// Assignment is immutable; editing changes only the Markdown.
export const updateSprintPlanSchema = createSprintPlanSchema.pick({ content: true }).strict();

export const wasteCategories = ["wastefulness", "imbalance", "overload"] as const;
export type WasteCategory = (typeof wasteCategories)[number];

export type ReflectionWaste = {
  category: WasteCategory;
  description: string;
};

export type SprintReflection = {
  id: number;
  authorId: number | null;
  authorName: string;
  sprintId: number;
  sprintNumber: number;
  summary: string;
  wastes: ReflectionWaste[];
  kaizenWhat: string;
  kaizenWhy: string;
  kaizenDone: string;
  impact: string;
  createdAt: string;
  additions?: ReflectionAddition[];
};

export const reflectionFields = ["summary", "kaizenWhat", "kaizenWhy", "kaizenDone", "impact", "wasteDescription", "newWaste"] as const;
export const reflectionFieldLabels: Record<(typeof reflectionFields)[number], string> = {
  summary: "Sprint summary", kaizenWhat: "Kaizen what", kaizenWhy: "Kaizen why",
  kaizenDone: "Definition of done", impact: "Impact statement",
  wasteDescription: "Waste description", newWaste: "New waste",
};
export const reflectionAdditionItemSchema = z.object({
  field: z.enum(reflectionFields),
  text: z.string().trim().max(100_000),
  wasteIndex: z.number().int().nonnegative().optional(),
  wasteAdditionId: z.number().int().positive().optional(),
  category: z.enum(wasteCategories).optional(),
}).strict().superRefine((item, ctx) => {
  const targetCount = Number(item.wasteIndex != null) + Number(item.wasteAdditionId != null);
  if ((item.field === "wasteDescription" && targetCount !== 1) ||
      (item.field !== "wasteDescription" && targetCount !== 0) ||
      (item.field === "newWaste" ? !item.category : item.category != null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid waste target or category" });
  }
});
export const appendReflectionSchema = z.object({
  additions: z.array(reflectionAdditionItemSchema).max(100).transform(items => items.filter(item => item.text.length > 0)),
}).strict().refine(input => input.additions.length > 0, "Add some new text");
export type AppendReflection = z.infer<typeof appendReflectionSchema>;
export type ReflectionAddition = z.infer<typeof reflectionAdditionItemSchema> & {
  id: number; reflectionId: number; authorId: number | null; authorName: string; createdAt: string;
};
export type ReflectionAccess = { sprintId: number; sprintNumber: number; submitted: boolean; canRead: boolean };

export const reflectionWasteSchema = z.object({
  category: z.enum(wasteCategories),
  description: z.string().trim().min(1, "Waste description is required"),
});

export const insertSprintReflectionSchema = z.object({
  sprintId: z.number().int().positive("Sprint is required"),
  summary: z.string().trim().min(1, "Sprint summary is required"),
  wastes: z.array(reflectionWasteSchema).min(2, "Add at least two wastes"),
  kaizenWhat: z.string().trim().min(1, "Kaizen what is required"),
  kaizenWhy: z.string().trim().min(1, "Kaizen why is required"),
  kaizenDone: z.string().trim().min(1, "Definition of done is required"),
  impact: z.string().trim().min(1, "Impact statement is required"),
});

export type InsertSprintReflection = z.infer<typeof insertSprintReflectionSchema>;

export const taskStatuses = ["not_started", "in_progress", "needs_review", "done"] as const;

export type Task = {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  isBlocked: boolean;
  blockedReason: string | null;
  size: "XXS" | "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: number | null;
  archivedAt: string | null;
  dueDate: string | null;
  assigneeIds: number[];
  projectId: number | null;
  milestoneId: number | null;
  sprintId: number | null;
};

export type InsertTask = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  isBlocked?: boolean;
  blockedReason?: string | null;
  size?: "XXS" | "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  createdBy?: number | null;
  dueDate?: string | null;
  assigneeIds?: number[];
  projectId?: number | null;
  milestoneId?: number | null;
  sprintId?: number | null;
};

export type UpdateTask = Partial<Omit<InsertTask, "createdBy">>;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1, "Display name is required"),
  registrationCode: z.string().min(1, "Registration code is required").max(256, "Registration code is too long"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const insertProjectSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  teamId: z.number().int().positive().nullable().optional(),
  teamIds: z.array(z.number().int().positive()).optional(),
});

export const updateProjectSchema = insertProjectSchema.partial();

export const insertMilestoneSchema = z.object({
  projectId: z.number(),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  timeline: z.string().nullable().optional(),
  excludedSprintIds: z.array(z.number().int().positive()).optional(),
});

export const updateMilestoneSchema = insertMilestoneSchema.partial().omit({ projectId: true });

export const insertTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().nullable().optional(),
  status: z.enum(taskStatuses).optional(),
  isBlocked: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
  size: z.enum(["XXS", "XS", "S", "M", "L", "XL", "XXL"]).nullable().optional(),
  createdBy: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  assigneeIds: z.array(z.number()).optional(),
  projectId: z.number().nullable().optional(),
  milestoneId: z.number().nullable().optional(),
  sprintId: z.number().nullable().optional(),
});

export const updateTaskSchema = insertTaskSchema.partial().omit({ createdBy: true });

export type TaskComment = {
  id: number;
  taskId: number;
  authorId: number | null;
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type InsertTaskComment = {
  taskId: number;
  authorId: number;
  body: string;
};

export const taskActivityEventTypes = [
  "created",
  "status_changed",
  "assignees_changed",
  "commented",
  "updated",
  "archived",
  "restored",
] as const;

export type TaskActivityEventType = (typeof taskActivityEventTypes)[number];

export type TaskActivity = {
  id: number | string;
  taskId: number;
  actorId: number | null;
  actorName: string;
  eventType: TaskActivityEventType;
  metadata: Record<string, unknown>;
  createdAt: string;
  synthetic?: boolean;
};

export const insertTaskCommentSchema = z.object({
  body: z.string().min(1, "Comment cannot be empty"),
});

export type TeamPost = {
  id: number;
  authorId: number | null;
  authorName: string | null;
  body: string;
  createdAt: string;
  pinned: boolean;
};

export type InsertTeamPost = {
  authorId: number;
  body: string;
};

export const insertTeamPostSchema = z.object({
  body: z.string().trim().min(1, "Post cannot be empty"),
});

export const insertDocumentSchema = z.object({
  title: z.string().min(1),
  filename: z.string().min(1),
  adminOnly: z.boolean().optional(),
  allowedUsers: z.array(z.string()).optional(),
  allowedDomain: z.string().nullable().optional(),
});

export type TaskStatus = (typeof taskStatuses)[number];
