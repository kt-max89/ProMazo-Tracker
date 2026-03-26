import { z } from "zod";
import { randomUUID } from "crypto";

const proposedTaskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToName: z.string().optional(),
});

export type ProposedTaskDraft = z.infer<typeof proposedTaskDraftSchema>;

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
      validTasks.push({
        title,
        description: parsed.data.description?.trim() || undefined,
        assignedToName: parsed.data.assignedToName?.trim() || undefined,
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
