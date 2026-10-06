import { z } from "zod";
import { randomUUID } from "crypto";
import { reviewedAssigneeIdsSchema } from "../shared/proposalAssignments";

const VALID_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;

const proposedTaskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToName: z.string().optional(),
  assigneeIds: reviewedAssigneeIdsSchema,
  projectName: z.string().optional(),
  milestoneName: z.string().optional(),
  dueDate: z.string().optional(),
  size: z.enum(VALID_SIZES).optional(),
  sprintId: z.number().nullable().optional(),
});

export type ProposedTaskDraft = z.infer<typeof proposedTaskDraftSchema>;

// Approval must not use the model's tolerant parser, which skips malformed rows.
export const reviewedProposalSchema = z.object({
  tasks: z.array(proposedTaskDraftSchema.extend({
    title: z.string().trim().min(1, "Task title is required"),
  }).transform(draft => ({
    ...draft,
    description: draft.description?.trim() || undefined,
    assignedToName: draft.assignedToName?.trim() || undefined,
    projectName: draft.projectName?.trim() || undefined,
    milestoneName: draft.milestoneName?.trim() || undefined,
    dueDate: draft.dueDate?.trim() || undefined,
  }))).min(1).max(5),
});


export type ValidatedProposal = {
  proposalId: string;
  type: "create_task";
  tasks: ProposedTaskDraft[];
};

export function validateProposal(raw: unknown): ValidatedProposal | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type !== "create_task") return null;
  if (!Array.isArray(obj.tasks)) return null;

  const validTasks: ProposedTaskDraft[] = [];
  for (const t of obj.tasks) {
    const parsed = proposedTaskDraftSchema.safeParse(t);
    if (parsed.success) {
      const title = parsed.data.title.trim();
      if (!title) continue;
      const description = parsed.data.description?.trim() || undefined;
      validTasks.push({
        title,
        description,
        assignedToName: parsed.data.assignedToName?.trim() || undefined,
        assigneeIds: parsed.data.assigneeIds,
        projectName: parsed.data.projectName?.trim() || undefined,
        milestoneName: parsed.data.milestoneName?.trim() || undefined,
        dueDate: parsed.data.dueDate?.trim() || undefined,
        size: parsed.data.size || undefined,
        sprintId: parsed.data.sprintId,
      });
    }
  }

  if (validTasks.length === 0) return null;

  return {
    proposalId: randomUUID(),
    type: "create_task",
    tasks: validTasks.slice(0, 5),
  };
}
