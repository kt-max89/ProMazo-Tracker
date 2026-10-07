import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RotateCw, X } from "lucide-react";
import type { Task, Project, Milestone, Sprint } from "@shared/schema";
import type { TaskEditChanges, TaskEditProposal } from "@shared/taskEdits";
import { effectiveTaskEditChanges } from "@shared/taskEdits";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRemoteUpdate } from "@/components/remote-update-notice";

type AppUser = { id: number; displayName: string; email: string; isActive: boolean };

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "needs_review", label: "Needs review" },
  { value: "done", label: "Done" },
] as const;
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;
const controlClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";
const labelClass = "text-xs font-medium text-muted-foreground";

function dateValue(value: string | null | undefined) {
  if (!value) return "";
  return value.slice(0, 10);
}

function statusLabel(status: string | null | undefined) {
  return STATUSES.find(item => item.value === status)?.label ?? "Not set";
}

function display(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function TaskEditProposalReview({
  proposal,
  onClose,
  onApproved,
}: {
  proposal: TaskEditProposal;
  onClose: () => void;
  onApproved: (task: Task) => void;
}) {
  const [changes, setChanges] = useState<TaskEditChanges>(() => effectiveTaskEditChanges(proposal.changes));
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<Task>(() => proposal.currentTask);
  const taskQuery = useQuery<Task>({
    queryKey: ["/api/tasks", proposal.taskId],
    queryFn: () => apiRequest("GET", `/api/tasks/${proposal.taskId}`).then(response => response.json()),
    initialData: proposal.currentTask,
    refetchOnMount: "always",
  });
  const latestTask = taskQuery.data ?? proposal.currentTask;
  const currentTask = snapshot;
  const remote = useRemoteUpdate(latestTask, true);
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const { data: sprints = [] } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });

  const projectId = Object.prototype.hasOwnProperty.call(changes, "projectId")
    ? changes.projectId ?? null
    : currentTask.projectId;
  const milestonesQuery = useQuery<Milestone[]>({
    queryKey: ["/api/projects", projectId, "milestones"],
    queryFn: () => projectId == null
      ? Promise.resolve([])
      : apiRequest("GET", `/api/projects/${projectId}/milestones`).then(response => response.json()),
    enabled: projectId != null,
  });
  const milestones = milestonesQuery.data ?? [];

  const proposed = useMemo(() => ({ ...currentTask, ...changes }), [currentTask, changes]);
  const selectedAssignees = proposed.assigneeIds ?? [];
  const selectedUserIds = new Set(selectedAssignees);
  const displayedUsers = [
    ...users.filter(user => user.isActive || selectedUserIds.has(user.id) || currentTask.assigneeIds.includes(user.id)),
    ...selectedAssignees.filter(id => !users.some(user => user.id === id)).map(id => ({
      id, displayName: `User #${id}`, email: "", isActive: false,
    })),
  ];
  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/task-edit-proposals/approve", {
      taskId: proposal.taskId,
      changes,
    }).then(response => response.json() as Promise<Task>),
    onSuccess: task => {
      queryClient.setQueryData(["/api/tasks", task.id], task);
      void queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id] });
      void queryClient.invalidateQueries({ queryKey: ["/api/tasks", task.id, "activity"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      onApproved(task);
    },
    onError: (cause: Error) => {
      setError(cause.message || "The task could not be updated. Check the latest task values and try again.");
    },
  });

  useEffect(() => {
    setError("");
  }, [changes]);

  function setChange<K extends keyof TaskEditChanges>(key: K, value: TaskEditChanges[K]) {
    setChanges(previous => ({ ...previous, [key]: value }));
  }

  async function reloadSnapshot() {
    const result = await taskQuery.refetch();
    if (result.data) setSnapshot(result.data);
    remote.accept();
  }

  function changeProject(value: string) {
    const nextProjectId = value === "none" ? null : Number(value);
    setChanges(previous => ({
      ...previous,
      projectId: nextProjectId,
      milestoneId: null,
    }));
  }

  function toggleAssignee(id: number, checked: boolean) {
    const next = checked
      ? [...selectedAssignees, id]
      : selectedAssignees.filter(existing => existing !== id);
    setChange("assigneeIds", next);
  }

  const changedFieldCount = Object.keys(changes).length;
  const pending = mutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-5"
      data-testid="task-edit-proposal-review">
      <section className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Task edit proposal · #{proposal.taskId}</p>
            <h2 className="mt-1 truncate text-lg font-semibold" title={currentTask.title}>{currentTask.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review each proposed value. Only adjusted fields will be sent.</p>
          </div>
          <button type="button" onClick={onClose} disabled={pending} aria-label="Close edit review"
            className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {remote.changed && (
            <div role="status" className="my-3 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
              <p>This task changed elsewhere. Your proposal is unchanged; compare it with the latest snapshot before applying.</p>
              <button type="button" className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-current/20 px-2.5 py-1.5 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
                onClick={reloadSnapshot}>
                <RotateCw className="h-3.5 w-3.5" /> Reload current snapshot · keep my changes
              </button>
            </div>
          )}
          {taskQuery.isError && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <span>Could not refresh the task. Your proposal remains available.</span>
              <button type="button" className="inline-flex shrink-0 items-center gap-1 underline"
                onClick={() => void taskQuery.refetch()}><RotateCw className="h-3.5 w-3.5" /> Retry</button>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <span className="text-muted-foreground">Task ID <strong className="font-mono text-foreground">#{proposal.taskId}</strong></span>
            <span className="text-muted-foreground">{changedFieldCount} field{changedFieldCount === 1 ? "" : "s"} included in approval</span>
          </div>

          <div className="space-y-4">
            <ReviewField label="Title" current={currentTask.title} proposed={proposed.title}>
              <input aria-label="Proposed title" data-testid="edit-proposal-title" className={controlClass}
                value={proposed.title ?? ""} disabled={pending}
                onChange={event => setChange("title", event.target.value)} />
            </ReviewField>

            <ReviewField label="Description" current={currentTask.description} proposed={proposed.description}>
              <textarea aria-label="Proposed description" data-testid="edit-proposal-description" className={`${controlClass} resize-y`}
                rows={4} value={proposed.description ?? ""} disabled={pending}
                onChange={event => setChange("description", event.target.value || null)} />
            </ReviewField>

            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewField label="Status" current={statusLabel(currentTask.status)} proposed={statusLabel(proposed.status)}>
                <select aria-label="Proposed status" data-testid="edit-proposal-status" className={controlClass}
                  value={proposed.status} disabled={pending}
                  onChange={event => setChange("status", event.target.value as TaskEditChanges["status"])}>
                  {STATUSES.map(status => <option key={status.value} value={status.value}>{status.label}</option>)}
                </select>
              </ReviewField>
              <ReviewField label="Blocked" current={currentTask.isBlocked ? "Yes" : "No"} proposed={proposed.isBlocked ? "Yes" : "No"}>
                <label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                  <input aria-label="Proposed blocked state" data-testid="edit-proposal-blocked" type="checkbox"
                    checked={proposed.isBlocked} disabled={pending}
                    onChange={event => setChanges(previous => ({
                      ...previous, isBlocked: event.target.checked,
                      ...(event.target.checked ? {} : { blockedReason: null }),
                    }))} />
                  Mark task as blocked
                </label>
              </ReviewField>
            </div>

            <ReviewField label="Blocked reason" current={currentTask.blockedReason} proposed={proposed.blockedReason}>
              <input aria-label="Proposed blocked reason" data-testid="edit-proposal-blocked-reason" className={controlClass}
                value={proposed.blockedReason ?? ""} disabled={pending}
                onChange={event => setChange("blockedReason", event.target.value || null)} />
            </ReviewField>

            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewField label="Project" current={projects.find(project => project.id === currentTask.projectId)?.name ?? "None"}
                proposed={projects.find(project => project.id === proposed.projectId)?.name ?? "None"}>
                <select aria-label="Proposed project" data-testid="edit-proposal-project" className={controlClass}
                  value={proposed.projectId == null ? "none" : String(proposed.projectId)} disabled={pending}
                  onChange={event => changeProject(event.target.value)}>
                  <option value="none">No project</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </ReviewField>
              <ReviewField label="Milestone" current={currentTask.milestoneId == null ? "None" : `#${currentTask.milestoneId}`}
                proposed={milestones.find(milestone => milestone.id === proposed.milestoneId)?.name ?? (proposed.milestoneId == null ? "None" : `#${proposed.milestoneId}`)}>
                <select aria-label="Proposed milestone" data-testid="edit-proposal-milestone" className={controlClass}
                  value={proposed.milestoneId == null ? "none" : String(proposed.milestoneId)}
                  disabled={pending || proposed.projectId == null || milestonesQuery.isLoading}
                  onChange={event => setChange("milestoneId", event.target.value === "none" ? null : Number(event.target.value))}>
                  <option value="none">No milestone</option>
                  {milestones.map(milestone => <option key={milestone.id} value={milestone.id}>{milestone.name}</option>)}
                </select>
              </ReviewField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ReviewField label="Sprint" current={currentTask.sprintId == null ? "Backlog" : `Sprint ${sprints.find(sprint => sprint.id === currentTask.sprintId)?.number ?? currentTask.sprintId}`}
                proposed={proposed.sprintId == null ? "Backlog" : `Sprint ${sprints.find(sprint => sprint.id === proposed.sprintId)?.number ?? proposed.sprintId}`}>
                <select aria-label="Proposed sprint" data-testid="edit-proposal-sprint" className={controlClass}
                  value={proposed.sprintId == null ? "backlog" : String(proposed.sprintId)} disabled={pending}
                  onChange={event => setChange("sprintId", event.target.value === "backlog" ? null : Number(event.target.value))}>
                  <option value="backlog">Backlog</option>
                  {sprints.map(sprint => <option key={sprint.id} value={sprint.id}>Sprint {sprint.number}</option>)}
                </select>
              </ReviewField>
              <ReviewField label="Size" current={currentTask.size} proposed={proposed.size}>
                <select aria-label="Proposed size" data-testid="edit-proposal-size" className={controlClass}
                  value={proposed.size ?? "none"} disabled={pending}
                  onChange={event => setChange("size", event.target.value === "none" ? null : event.target.value as NonNullable<TaskEditChanges["size"]>)}>
                  <option value="none">No size</option>
                  {SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                </select>
              </ReviewField>
            </div>

            <ReviewField label="Due date" current={dateValue(currentTask.dueDate) || "None"} proposed={dateValue(proposed.dueDate) || "None"}>
              <input aria-label="Proposed due date" data-testid="edit-proposal-due-date" type="date" className={controlClass}
                value={dateValue(proposed.dueDate)} disabled={pending}
                onChange={event => setChange("dueDate", event.target.value || null)} />
            </ReviewField>

            <ReviewField label="Assignees"
              current={currentTask.assigneeIds.map(id => users.find(user => user.id === id)?.displayName ?? `User #${id}`).join(", ") || "Unassigned"}
              proposed={selectedAssignees.map(id => users.find(user => user.id === id)?.displayName ?? `User #${id}`).join(", ") || "Unassigned"}>
              <div className="max-h-44 overflow-y-auto rounded-md border p-2">
                {displayedUsers.map(user => (
                  <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <input aria-label={`Assign ${user.displayName} (${user.email || `#${user.id}`})`}
                      data-testid={`edit-proposal-assignee-${user.id}`} type="checkbox"
                      checked={selectedAssignees.includes(user.id)} disabled={pending}
                      onChange={event => toggleAssignee(user.id, event.target.checked)} />
                    <span>{user.displayName}</span>
                    {!user.isActive && <span className="text-xs text-muted-foreground">Inactive · retained only if selected</span>}
                  </label>
                ))}
                {!users.length && <p className="px-2 py-1 text-sm text-muted-foreground">No users are available.</p>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Active users across the workspace are available; existing inactive assignments are retained unless removed.</p>
            </ReviewField>
          </div>

          {error && (
            <div role="alert" className="mt-4 flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div><p className="font-medium">Approval failed</p><p className="mt-1">{error}</p><p className="mt-1 text-xs">Your edits are still here. Review the fields and try again.</p></div>
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-xs text-muted-foreground">Current task values are shown above each proposed value.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={pending}
              className="rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">Not now</button>
            <button type="button" data-testid="button-approve-task-edit" onClick={() => { setError(""); mutation.mutate(); }}
              disabled={pending || taskQuery.isError}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Apply task changes
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ReviewField({
  label, current, proposed, children,
}: {
  label: string;
  current: string | number | boolean | null | undefined;
  proposed: string | number | boolean | null | undefined;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className={labelClass}>{label}</span>
        <span className="min-w-0 truncate text-right text-xs text-muted-foreground" title={`Current: ${display(current)} · Proposed: ${display(proposed)}`}>
          <span className="hidden sm:inline">Current: </span>{display(current)}
          <span className="px-1 text-muted-foreground/60">→</span>
          <span className="font-medium text-foreground">{display(proposed)}</span>
        </span>
      </div>
      {children}
    </div>
  );
}
