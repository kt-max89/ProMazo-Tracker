import { AlertTriangle, Ban, Flag, Pencil, UserCircle2, Calendar, Folder } from "lucide-react";
import type { Task, Milestone, Project } from "@shared/schema";

type AppUser = { id: number; displayName: string; email: string };

export function formatDueDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function isTaskOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  const today = new Date();
  const [y, m, d] = task.dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  return due < new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

// ── Color palettes ──────────────────────────────────────────────────────────

export const SIZE_COLORS: Record<string, string> = {
  XXS: "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  XS:  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  S:   "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  M:   "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  L:   "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  XL:  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  XXL: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

// Stable palette — color is determined by the project's sorted rank so the
// same project always gets the same color regardless of load order.
export const PROJECT_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
];

/** Returns a stable CSS class string for a given project ID. */
export function getProjectColorClass(projectId: number, projects: Project[]): string {
  const sorted = [...projects].sort((a, b) => a.id - b.id);
  const idx = sorted.findIndex(p => p.id === projectId);
  return PROJECT_COLORS[Math.max(0, idx) % PROJECT_COLORS.length];
}

// ── Component ───────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task;
  users: AppUser[];
  milestones: Milestone[];
  /** When provided, a colored project badge is shown on the card. */
  projects?: Project[];
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

export function TaskCard({
  task,
  users,
  milestones,
  projects,
  onClick,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const assignees = users.filter(u => task.assigneeIds.includes(u.id));
  const milestone = task.milestoneId != null ? milestones.find(m => m.id === task.milestoneId) : null;
  const project   = (projects && task.projectId != null)
    ? projects.find(p => p.id === task.projectId)
    : null;
  const overdue   = isTaskOverdue(task);
  const draggable = !!onDragStart;

  const sizeClass    = task.size ? (SIZE_COLORS[task.size] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300") : "";
  const projectClass = (project && projects) ? getProjectColorClass(project.id, projects) : "";

  return (
    <div
      data-testid={`card-task-${task.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      data-blocked={task.isBlocked || undefined}
      className={`bg-white dark:bg-card border rounded-lg p-3 ${draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} hover:shadow-md transition-all group select-none ${
        task.isBlocked
          ? "border-2 border-red-500 dark:border-red-500 hover:border-red-500"
          : overdue
          ? "border-orange-300 dark:border-orange-700 hover:border-orange-400"
          : "hover:border-primary/30"
      }`}
    >
      {/* Title row */}
      <div className="flex items-start justify-between gap-2">
        {task.isBlocked && (
          <AlertTriangle
            className="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5"
            data-testid={`icon-blocked-${task.id}`}
          />
        )}
        <p className="text-sm font-medium leading-snug flex-1" data-testid={`text-task-title-${task.id}`}>
          {task.title}
        </p>
        <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 shrink-0 mt-0.5" />
      </div>

      {/* Badges: project · milestone · size */}
      {(project || milestone || task.size) && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {project && (
            <span
              className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium max-w-full ${projectClass}`}
              data-testid={`badge-project-${task.id}`}
            >
              <Folder className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {milestone && (
            <span
              className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-medium max-w-full"
              data-testid={`badge-milestone-${task.id}`}
            >
              <Flag className="w-2.5 h-2.5 shrink-0" />
              <span className="truncate">{milestone.name}</span>
            </span>
          )}
          {task.size && (
            <span
              className={`inline-flex items-center text-xs px-1.5 py-0.5 rounded font-medium ${sizeClass}`}
              data-testid={`badge-size-${task.id}`}
            >
              {task.size}
            </span>
          )}
        </div>
      )}

      {/* Blocked reason */}
      {task.isBlocked && task.blockedReason && (
        <div className="flex items-center gap-1 mt-2 text-xs text-red-600 dark:text-red-500" data-testid={`text-blocked-reason-${task.id}`}>
          <Ban className="w-3 h-3 shrink-0" />
          <span className="truncate">{task.blockedReason}</span>
        </div>
      )}

      {/* Footer: assignees + due date */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
        {assignees.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground" data-testid={`text-assignee-${task.id}`}>
            <UserCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span className="break-words">{assignees.map(a => a.displayName).join(", ")}</span>
          </div>
        )}
        {task.dueDate && (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${
              overdue ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
            }`}
            data-testid={`badge-due-${task.id}`}
          >
            <Calendar className="w-3 h-3 shrink-0" />
            <span>{overdue ? "Overdue · " : "Due "}{formatDueDate(task.dueDate)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
