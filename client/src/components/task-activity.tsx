import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import type { TaskActivity as TaskActivityItem } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  done: "Done",
};

function describeActivity(activity: TaskActivityItem): string {
  const metadata = activity.metadata;
  switch (activity.eventType) {
    case "created":
      return "Created the task";
    case "status_changed":
      return `Moved to ${STATUS_LABELS[String(metadata.to)] ?? String(metadata.to ?? "an updated status")}`;
    case "assignees_changed": {
      const added = Array.isArray(metadata.added) ? metadata.added.filter(Boolean).join(", ") : "";
      const removed = Array.isArray(metadata.removed) ? metadata.removed.filter(Boolean).join(", ") : "";
      if (added && !removed) return `Assigned to ${added}`;
      if (removed && !added) return `Unassigned ${removed}`;
      return `Assigned to ${added || "no one"}; unassigned ${removed || "no one"}`;
    }
    case "commented":
      return "Added a comment";
    case "archived":
      return "Archived the task";
    case "restored":
      return "Restored the task";
    case "updated": {
      const fields = Array.isArray(metadata.fields)
        ? metadata.fields as Array<{ field?: string; to?: string | null }>
        : [];
      const descriptions = fields.map(item => {
        const field = item.field || "task information";
        if (item.to !== undefined) return `changed ${field} to ${item.to ?? "none"}`;
        return `changed ${field}`;
      });
      return descriptions.length
        ? descriptions.join(", ").replace(/^./, character => character.toUpperCase())
        : "Updated task information";
    }
    default:
      return "Updated task activity";
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function actorLabel(activity: TaskActivityItem): string {
  // Historical activity remains visible when its actor is deleted.
  return activity.actorName?.trim() || (activity.actorId == null ? "System" : "Deleted user");
}

export function TaskActivity({ taskId }: { taskId: number }) {
  const { data = [], isLoading, error } = useQuery<TaskActivityItem[]>({
    queryKey: ["/api/tasks", taskId, "activity"],
    queryFn: () => apiRequest("GET", `/api/tasks/${taskId}/activity`).then(response => response.json()),
  });

  return (
    <div data-testid="task-activity-section">
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Activity className="h-4 w-4" />
        Activity
      </h3>
      {isLoading ? (
        <div className="space-y-3 py-1" aria-label="Loading activity">
          {[0, 1, 2].map(item => (
            <div key={item} className="flex gap-3">
              <Skeleton className="mt-1 h-3 w-3 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Could not load activity.
        </p>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="space-y-0" data-testid="list-task-activity" aria-label="Task activity history">
          {data.map((item, index) => (
            <li key={item.id} className="relative flex gap-2.5 pb-3.5 last:pb-0">
              {index < data.length - 1 && (
                <span className="absolute left-[5px] top-3 h-full w-px bg-border" aria-hidden />
              )}
              <span
                className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-background bg-muted-foreground/50 ring-1 ring-border"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-[13px] leading-5">
                  <span className={actorLabel(item) === "Deleted user" ? "font-medium text-muted-foreground" : "font-medium"}>
                    {actorLabel(item)}
                  </span>{" "}
                  <span className="text-muted-foreground">{describeActivity(item)}</span>
                </p>
                <time className="text-[11px] leading-4 text-muted-foreground/80" dateTime={item.createdAt}>
                  {formatTimestamp(item.createdAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}