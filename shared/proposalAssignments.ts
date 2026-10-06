import { z } from "zod";

// Reviewed IDs are optional for compatibility with the model's single-name drafts.
export const reviewedAssigneeIdsSchema = z.array(z.number().int().positive()).optional();
export type AssignmentUser = {
  id: number;
  displayName: string;
  email: string;
  teamId: number | null;
  isActive: boolean;
};

export function eligibleProposalUsers(users: AssignmentUser[], reviewer: AssignmentUser | undefined) {
  return reviewer?.isActive && reviewer.teamId != null
    ? users.filter(user => user.isActive && user.teamId === reviewer.teamId)
    : [];
}

export function legacyProposalAssignment(
  name: string | undefined, users: AssignmentUser[], reviewer: AssignmentUser | undefined,
): { ids: number[]; warning?: string } {
  const eligible = eligibleProposalUsers(users, reviewer);
  if (!name?.trim()) return { ids: eligible.some(user => user.id === reviewer?.id) ? [reviewer!.id] : [] };
  const normalized = name.trim().toLowerCase();
  const exact = eligible.filter(user => user.displayName.trim().toLowerCase() === normalized);
  const matches = exact.length ? exact : eligible.filter(user => user.displayName.toLowerCase().includes(normalized));
  if (matches.length === 1) return { ids: [matches[0].id] };
  return {
    ids: [],
    warning: matches.length > 1
      ? `Suggested assignee "${name}" is ambiguous. Choose a person by email, or leave this task unassigned.`
      : `Suggested assignee "${name}" is unavailable in your active team. Choose another person, or leave this task unassigned.`,
  };
}

export class ProposalAssignmentError extends Error {}

// Validate the whole batch before calling task creation.
export function resolveProposalAssignments(
  drafts: { title: string; assigneeIds?: number[]; assignedToName?: string }[],
  users: AssignmentUser[], reviewerId: number,
): number[][] {
  const reviewer = users.find(user => user.id === reviewerId);
  if (!reviewer?.isActive) throw new ProposalAssignmentError("Your account is no longer active. Sign in again before approving.");
  const eligible = new Set(eligibleProposalUsers(users, reviewer).map(user => user.id));
  return drafts.map((draft, index) => {
    let ids = draft.assigneeIds;
    if (ids === undefined) {
      const legacy = legacyProposalAssignment(draft.assignedToName, users, reviewer);
      if (legacy.warning) throw new ProposalAssignmentError(`Task ${index + 1}: ${legacy.warning}`);
      ids = legacy.ids;
    }
    const unique = Array.from(new Set(ids));
    const invalid = unique.filter(id => !eligible.has(id));
    if (invalid.length) {
      const names = invalid.map(id => users.find(user => user.id === id)?.displayName ?? `User #${id}`);
      throw new ProposalAssignmentError(`Task ${index + 1} (${draft.title}): ${names.join(", ")} no longer eligible. Remove these selections or choose active members of your current team, then approve again.`);
    }
    return unique;
  });
}
