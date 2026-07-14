import { AlertTriangle, Ban, Flag, Pencil, UserCircle2, Calendar } from "lucide-react";
import type { Task, Milestone } from "@shared/schema";

type AppUser = { id: number; displayName: string; email: string };

export function formatDueDate(dateStr: string): string {
  // Parse as local date to avoid timezone shift
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

interface TaskCardProps {
  task: Task;
  users: AppUser[];
  milestones: Milestone[];
  onClick: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
}

export function TaskCard({
  task,
  users,
  milestones,
  onClick,
  onDragStart,
  onDragEnd,
}: TaskCardProps) {
  const assignees = users.filter(u => task.assigneeIds.includes(u.id));
  const milestone = task.milestoneId != null ? milestones.find(m => m.id === task.milestoneId) : null;
  const overdue = isTaskOverdue(task);
  const draggable = !!onDragStart;

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

      {(milestone || task.size) && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
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
              className="inline-flex items-center text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-medium"
              data-testid={`badge-size-${task.id}`}
            >
              {task.size}
            </span>
          )}
        </div>
      )}

      {task.isBlocked && task.blockedReason && (
        <div className="flex items-center gap-1 mt-2 text-xs text-red-600 dark:text-red-500" data-testid={`text-blocked-reason-${task.id}`}>
          <Ban className="w-3 h-3 shrink-0" />
          <span className="truncate">{task.blockedReason}</span>
        </div>
      )}

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
              overdue
                ? "text-red-600 dark:text-red-400"
                : "text-muted-foreground"
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
