import type { ValidatedProposal } from "./proposalSchema";

type Named = { id: number; name: string };
// Ground generated references only. Approval eligibility, defaults, and user
// changes in the existing review are deliberately not changed here.
export function groundCreationReferences(
  proposal: ValidatedProposal,
  sources: {
    projects: Named[];
    milestones: Array<Named & { projectId: number }>;
    users: Array<{ id: number; displayName: string; isActive?: boolean }>;
  },
) {
  const warnings: string[] = [];
  const match = <T extends Named>(rows: T[], name: string) =>
    rows.filter(row => row.name.trim().toLowerCase() === name.trim().toLowerCase());
  const tasks = proposal.tasks.map(task => {
    const grounded = { ...task };
    if (task.assignedToName) {
      const users = sources.users.filter(user => user.isActive !== false &&
        user.displayName.trim().toLowerCase() === task.assignedToName!.trim().toLowerCase());
      if (users.length !== 1) {
        grounded.assigneeIds = [];
        warnings.push(`Assignee "${task.assignedToName}" ${users.length > 1 ? `is ambiguous (user IDs ${users.map(u => u.id).join(", ")})` : "could not be resolved exactly"}. Choose the assignee in review.`);
      }
    }
    if (task.projectName) {
      const projects = match(sources.projects, task.projectName);
      if (projects.length !== 1) {
        delete grounded.projectName;
        delete grounded.milestoneName;
        warnings.push(`Project "${task.projectName}" ${projects.length > 1 ? `is ambiguous (project IDs ${projects.map(p => p.id).join(", ")})` : "could not be resolved exactly"}. Which project and milestone do you mean?`);
      } else {
        const milestones = sources.milestones.filter(m => m.projectId === projects[0].id);
        if (!task.milestoneName || match(milestones, task.milestoneName).length !== 1) {
          // The legacy approval defaults to the first milestone. Do not let an
          // unresolved generated reference reach that fallback accidentally.
          delete grounded.projectName;
          delete grounded.milestoneName;
          warnings.push(`Choose a specific milestone for project "${task.projectName}"; the draft's project was left unset to avoid guessing.`);
        }
      }
    } else if (task.milestoneName) {
      delete grounded.milestoneName;
      warnings.push(`Milestone "${task.milestoneName}" needs a specific project. Which project do you mean?`);
    }
    return grounded;
  });
  return { proposal: { ...proposal, tasks }, warnings };
}
