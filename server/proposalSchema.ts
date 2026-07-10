import { z } from "zod";
import { randomUUID } from "crypto";

const proposedTaskDraftSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  assignedToName: z.string().optional(),
});

export type ProposedTaskDraft = z.infer<typeof proposedTaskDraftSchema>;

// Every AI-proposed task description must contain these three sections, in order,
// each with non-empty content, matching the format instructed in promptBuilder.ts.
const REQUIRED_SECTIONS = [
  /##\s*what\s*&\s*why/i,
  /##\s*steps/i,
  /##\s*resources\s*\/?\s*context/i,
];

// Matches any markdown heading line (## Foo) so we can detect extra sections
// beyond the three required ones.
const ANY_HEADING = /^#{1,6}\s*.+$/gm;

function hasValidSectionStructure(description: string): boolean {
  const positions = REQUIRED_SECTIONS.map((re) => {
    const match = re.exec(description);
    return match ? match.index : -1;
  });

  // Every section header must be present.
  if (positions.some((idx) => idx === -1)) return false;

  // Sections must appear in the required order.
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] <= positions[i - 1]) return false;
  }

  // Exactly three headings total — no extra sections beyond the required ones.
  const headingCount = [...description.matchAll(ANY_HEADING)].length;
  if (headingCount !== REQUIRED_SECTIONS.length) return false;

  // Each section (up to the next header or end of string) must have non-empty content.
  const boundaries = [...positions, description.length];
  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    const headerMatch = REQUIRED_SECTIONS[i].exec(description.slice(boundaries[i]));
    const headerEnd = boundaries[i] + (headerMatch ? headerMatch[0].length : 0);
    const content = description.slice(headerEnd, boundaries[i + 1]).trim();
    if (!content) return false;
  }

  return true;
}

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
      // Require a description with the 3-section structure (What & Why / Steps /
      // Resources) — drop proposals that skip a section or lack a description
      // entirely, rather than letting malformed proposals reach the task board.
      if (!description || !hasValidSectionStructure(description)) continue;
      validTasks.push({
        title,
        description,
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
