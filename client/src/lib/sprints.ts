import type { Sprint, Task } from "@shared/schema";

export type SprintFilterValue = "current" | "all" | "backlog" | `sprint-${number}`;

export function taskMatchesSprint(
  task: Task,
  filter: SprintFilterValue,
  currentSprintId: number | null | undefined,
): boolean {
  if (filter === "all") return true;
  if (filter === "backlog") return task.sprintId == null;
  if (filter === "current") {
    return currentSprintId != null && task.sprintId === currentSprintId;
  }
  return task.sprintId === Number(filter.replace("sprint-", ""));
}

export function getSprintLabel(sprintId: number | null, sprints: Sprint[]): string {
  if (sprintId == null) return "Backlog";
  const sprint = sprints.find((item) => item.id === sprintId);
  return sprint ? `Sprint ${sprint.number}` : "Sprint";
}