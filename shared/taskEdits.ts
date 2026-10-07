import { z } from "zod";
import { taskStatuses, type Task } from "./schema";

const id = z.number().int().positive();
const optionalId = id.nullable().optional();
export const taskEditFields = ["title", "description", "status", "isBlocked", "blockedReason", "size", "dueDate", "assigneeIds", "projectId", "milestoneId", "sprintId"] as const;
export type TaskEditField = typeof taskEditFields[number];
export const taskEditChangesSchema = z.object({
  title: z.string().trim().min(1, "Title is required").optional(),
  description: z.string().nullable().optional(),
  status: z.enum(taskStatuses).optional(),
  isBlocked: z.boolean().optional(),
  blockedReason: z.string().nullable().optional(),
  size: z.enum(["XXS", "XS", "S", "M", "L", "XL", "XXL"]).nullable().optional(),
  dueDate: z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    "Due date must be a real date in YYYY-MM-DD format").nullable().optional(),
  assigneeIds: z.array(id).refine(ids => new Set(ids).size === ids.length, "Select each assignee only once").optional(),
  projectId: optionalId,
  milestoneId: optionalId,
  sprintId: optionalId,
}).strict().refine(changes => Object.keys(changes).length > 0, "Choose at least one field to edit");

export const reviewedTaskEditSchema = z.object({
  taskId: id,
  changes: taskEditChangesSchema,
}).strict();
export const modelTaskEditSchema = reviewedTaskEditSchema.extend({ type: z.literal("edit_task") }).strict();
export type TaskEditChanges = z.infer<typeof taskEditChangesSchema>;
// Mirror the ordinary mutation's dependent-field semantics in the review.
export function effectiveTaskEditChanges(changes: TaskEditChanges): TaskEditChanges {
  return changes.isBlocked === false && changes.blockedReason === undefined
    ? { ...changes, blockedReason: null } : changes;
}
export type TaskEditProposal = z.infer<typeof modelTaskEditSchema> & {
  proposalId: string;
  currentTask: Task;
};
