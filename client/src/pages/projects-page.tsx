import { useState } from "react";
import { LivePresence } from "@/lib/live";
import { RemoteUpdateNotice, useRemoteUpdate } from "@/components/remote-update-notice";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth";
import {
  Plus, Loader2, Pencil, FolderOpen, Sun, Moon, LogOut,
  Zap, BookOpen, Settings, PanelLeft, CalendarDays, AlignLeft, ExternalLink,
  Flag, Trash2, Check, X, AlertTriangle, Search, UsersRound
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Project, Task, Milestone, Sprint, TrackerSettings, Team } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { SearchBar } from "@/components/search-bar";
import { SprintFilterSelect } from "@/components/sprint-filter-select";
import { taskMatchesSprint, type SprintFilterValue } from "@/lib/sprints";
type SharedProject = Project & { teamIds?: number[]; teamId?: number | null };

// ─── Project form ─────────────────────────────────────────────────────────────

const projectFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  timeline: z.string().optional(),
});
type ProjectFormValues = z.infer<typeof projectFormSchema>;

type MilestoneDraft = { name: string; description: string; excludedSprintIds: number[] };

function ProjectFormDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
}) {
  const { toast } = useToast();
  const isEdit = !!project;
  const latestQuery = useQuery<Project>({
    queryKey: ["/api/projects", project?.id],
    queryFn: () => apiRequest("GET", `/api/projects/${project!.id}`).then(r => r.json()),
    enabled: !!project && open,
    initialData: project,
  });
  const latest = latestQuery.data ?? project;
  const remote = useRemoteUpdate(latest, open && isEdit);
  const { data: teams = [], isLoading: teamsLoading, isError: teamsError, refetch: refetchTeams } = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const { data: sprints = [], isLoading: sprintsLoading, isError: sprintsError, refetch: refetchSprints } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });
  const [teamIds, setTeamIds] = useState<number[]>(project ? ((project as SharedProject).teamIds ?? (project.teamId == null ? [] : [project.teamId])) : []);

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      timeline: project?.timeline ?? "",
    },
  });

  // Milestone drafts (only for new projects)
  const [milestones, setMilestones] = useState<MilestoneDraft[]>([]);
  const [newMs, setNewMs] = useState<MilestoneDraft>({ name: "", description: "", excludedSprintIds: [] });

  function addMilestone() {
    if (!newMs.name.trim() || isPending || sprintsLoading || sprintsError) return;
    setMilestones(prev => [...prev, { ...newMs }]);
    setNewMs({ name: "", description: "", excludedSprintIds: [] });
  }

  function removeMilestone(idx: number) {
    setMilestones(prev => prev.filter((_, i) => i !== idx));
  }

  const createMutation = useMutation({
    mutationFn: (data: ProjectFormValues) =>
      apiRequest("POST", "/api/projects", { ...data, teamIds, milestones }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
      toast({ title: "Project created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ProjectFormValues) =>
      apiRequest("PATCH", `/api/projects/${project!.id}`, { ...data, teamIds }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      toast({ title: "Project updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(data: ProjectFormValues) {
    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "Edit the project details." : "Fill in the details to create a new project."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <RemoteUpdateNotice changed={remote.changed} reload={() => {
              if (!latest) return;
              form.reset({ name: latest.name, description: latest.description ?? "", timeline: latest.timeline ?? "" });
              setTeamIds((latest as SharedProject).teamIds ?? (latest.teamId == null ? [] : [latest.teamId]));
              remote.accept();
            }} />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Project name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="What is this project about?" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timeline</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Q3 2026, 2 weeks, June–August" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Teams</legend>
              <p className="text-xs text-muted-foreground">A project can be shared with more than one team.</p>
              {teamsLoading ? <p role="status" className="text-sm text-muted-foreground">Loading teams…</p> : teamsError ? <p className="text-sm text-destructive">Teams couldn’t be loaded. <button type="button" className="underline" onClick={() => refetchTeams()}>Retry</button></p> : teams.length ? <div className="grid max-h-36 gap-1 overflow-y-auto rounded-lg border p-2 sm:grid-cols-2">
                {teams.map(team => <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" disabled={isPending} checked={teamIds.includes(team.id)} onChange={e => setTeamIds(ids => e.target.checked ? [...ids, team.id] : ids.filter(id => id !== team.id))} />
                  <span className="truncate">{team.name}</span>
                </label>)}
              </div> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No teams yet. Create one from Team Overview.</p>}
            </fieldset>

            {/* Milestones section — only shown when creating a new project */}
            {!isEdit && (
              <div className="space-y-2 pt-1">
                <p className="text-sm font-medium">Milestones</p>
                {milestones.length > 0 && (
                  <div className="space-y-1">
                    {milestones.map((m, i) => (
                      <div key={i} className="flex min-w-0 flex-col gap-2 bg-muted/50 rounded-lg px-3 py-2 text-sm">
                        <div className="flex min-w-0 items-start gap-2">
                          <Flag className="mt-0.5 w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">{m.name}</span>
                        </div>
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <SprintLabels sprints={sprints} excludedSprintIds={m.excludedSprintIds} />
                          <button type="button" onClick={() => removeMilestone(i)} disabled={isPending} aria-label={`Remove milestone ${m.name}`} title={`Remove ${m.name}`} className="shrink-0 rounded p-1 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
                  <Input
                    placeholder="Milestone name"
                    value={newMs.name}
                    onChange={e => setNewMs(p => ({ ...p, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addMilestone(); } }}
                  />
                  <fieldset className="space-y-1.5">
                    <legend className="text-xs font-medium text-muted-foreground">Included sprints</legend>
                    {sprintsLoading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin"/>Loading sprints…</p> : sprintsError ? <p className="text-xs text-destructive">Sprints couldn’t be loaded. <button type="button" className="underline" onClick={() => refetchSprints()}>Retry</button></p> : sprints.length === 0 ? <p className="text-xs text-muted-foreground">No sprints yet. Future sprints will be included by default.</p> : <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {sprints.map(sprint => <label key={sprint.id} className="flex items-center gap-1.5 text-xs">
                        <input type="checkbox" disabled={isPending} aria-label={`Include Sprint ${sprint.number}`} checked={!newMs.excludedSprintIds.includes(sprint.id)} onChange={e => setNewMs(p => ({ ...p, excludedSprintIds: e.target.checked ? p.excludedSprintIds.filter(id => id !== sprint.id) : [...p.excludedSprintIds, sprint.id] }))} />
                        Sprint {sprint.number}
                      </label>)}
                    </div>}
                  </fieldset>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" onClick={addMilestone} disabled={!newMs.name.trim() || isPending || sprintsLoading || sprintsError}>
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {isEdit ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Milestone inline manager (on the card) ───────────────────────────────────

function SprintLabels({ sprints, excludedSprintIds }: { sprints: Sprint[]; excludedSprintIds: number[] }) {
  const included = sprints.filter(sprint => !excludedSprintIds.includes(sprint.id));
  if (included.length === 0) {
    return <span className="text-[10px] text-muted-foreground">{sprints.length ? "No sprints selected" : "No sprints yet · future included"}</span>;
  }
  return <span className="flex min-w-0 max-w-full flex-wrap justify-start gap-1">{included.map(sprint => <span key={sprint.id} className="max-w-full break-words rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Sprint {sprint.number}</span>)}</span>;
}

export function MilestoneManager({ project }: { project: Project }) {
  const { toast } = useToast();
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExcludedSprintIds, setNewExcludedSprintIds] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editExcludedSprintIds, setEditExcludedSprintIds] = useState<number[]>([]);
  const { data: sprints = [], isLoading: sprintsLoading, isError: sprintsError, refetch: refetchSprints } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });

  const { data: milestones = [], isLoading, isError, refetch } = useQuery<Milestone[]>({
    queryKey: ["/api/projects", project.id, "milestones"],
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/milestones`).then(r => r.json()),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id, "milestones"] });
    queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", project.id] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };

  const createMs = useMutation({
    mutationFn: (data: { name: string; excludedSprintIds: number[] }) =>
      apiRequest("POST", `/api/projects/${project.id}/milestones`, data).then(r => r.json()),
    onSuccess: () => { invalidate(); setAddingNew(false); setNewName(""); setNewExcludedSprintIds([]); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMs = useMutation({
    mutationFn: ({ id, name, excludedSprintIds }: { id: number; name: string; excludedSprintIds: number[] }) =>
      apiRequest("PATCH", `/api/milestones/${id}`, { name, excludedSprintIds }).then(r => r.json()),
    onSuccess: () => { invalidate(); setEditingId(null); },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMs = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/milestones/${id}`).then(r => r.json()),
    onSuccess: () => {
      invalidate();
      // Also refresh tasks since milestone references may be cleared
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "archived"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function startEdit(m: Milestone) {
    setEditingId(m.id);
    setEditName(m.name);
    setEditExcludedSprintIds((m as Milestone & { excludedSprintIds?: number[] }).excludedSprintIds ?? []);
  }

  function cancelEdit() { setEditingId(null); }

  return (
    <div className="border-t pt-3 flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Milestones ({milestones.length})
        </p>
        <button
          type="button"
          onClick={() => setAddingNew(v => !v)}
          disabled={createMs.isPending || updateMs.isPending || deleteMs.isPending}
          aria-label={addingNew ? "Close new milestone form" : "Add milestone"}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mx-auto" />}
      {isError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          Couldn’t load milestones. <button className="underline" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      {milestones.map(m => (
        <div key={m.id} className="min-w-0 rounded-lg px-2 py-1.5 hover:bg-muted/50 transition-colors group">
          {editingId === m.id ? (
            <div className="flex flex-col gap-1.5">
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="h-7 text-xs"
                autoFocus
                disabled={updateMs.isPending}
              />
              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-muted-foreground">Included sprints</legend>
                {sprintsLoading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin"/>Loading sprints…</p> : sprintsError ? <p className="text-xs text-destructive">Sprints couldn’t be loaded. <button type="button" className="underline" onClick={() => refetchSprints()}>Retry</button></p> : sprints.length === 0 ? <p className="text-xs text-muted-foreground">No sprints yet. Future sprints will be included by default.</p> : <div className="flex flex-wrap gap-x-3 gap-y-2">{sprints.map(sprint => <label key={sprint.id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" disabled={updateMs.isPending} aria-label={`Include Sprint ${sprint.number}`} checked={!editExcludedSprintIds.includes(sprint.id)} onChange={e => setEditExcludedSprintIds(ids => e.target.checked ? ids.filter(id => id !== sprint.id) : [...ids, sprint.id])} />
                  Sprint {sprint.number}
                </label>)}</div>}
              </fieldset>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  onClick={() => updateMs.mutate({ id: m.id, name: editName, excludedSprintIds: editExcludedSprintIds })}
                  disabled={!editName.trim() || updateMs.isPending || sprintsLoading || sprintsError}
                  aria-label="Save milestone changes"
                  title="Save milestone changes"
                  className="rounded p-1 text-green-600 transition-colors hover:bg-green-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {updateMs.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
                <button type="button" onClick={cancelEdit} disabled={updateMs.isPending} aria-label="Cancel milestone editing" title="Cancel" className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex min-w-0 items-start gap-2">
                <Flag className="mt-0.5 w-3 h-3 text-primary shrink-0" />
                <span className="min-w-0 flex-1 break-words text-sm [overflow-wrap:anywhere]">{m.name}</span>
              </div>
              <div className="flex min-w-0 items-start justify-between gap-2 pl-5">
                <SprintLabels sprints={sprints} excludedSprintIds={(m as Milestone & { excludedSprintIds?: number[] }).excludedSprintIds ?? []} />
                <div className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <button
                  type="button"
                  onClick={() => startEdit(m)}
                  disabled={createMs.isPending || updateMs.isPending || deleteMs.isPending}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Rename milestone"
                  aria-label={`Edit ${m.name}`}
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  disabled={createMs.isPending || updateMs.isPending || deleteMs.isPending}
                  onClick={() => {
                    if (confirm(`Remove milestone "${m.name}"? Tasks assigned to it will have their milestone cleared.`)) {
                      deleteMs.mutate(m.id);
                    }
                  }}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Remove milestone"
                  aria-label={`Remove ${m.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {milestones.length === 0 && !isLoading && !isError && !addingNew && (
        <p className="text-xs text-muted-foreground italic">No milestones yet</p>
      )}

      {addingNew && (
        <div className="border rounded-lg p-2 space-y-1.5 bg-muted/20 mt-1">
          <Input
            placeholder="Milestone name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="h-7 text-xs"
            autoFocus
            disabled={createMs.isPending}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (newName.trim() && !createMs.isPending && !sprintsLoading && !sprintsError) createMs.mutate({ name: newName, excludedSprintIds: newExcludedSprintIds }); } }}
          />
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Included sprints</legend>
            {sprintsLoading ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin"/>Loading sprints…</p> : sprintsError ? <p className="text-xs text-destructive">Sprints couldn’t be loaded. <button type="button" className="underline" onClick={() => refetchSprints()}>Retry</button></p> : sprints.length === 0 ? <p className="text-xs text-muted-foreground">No sprints yet. Future sprints will be included by default.</p> : <div className="flex flex-wrap gap-x-3 gap-y-2">{sprints.map(sprint => <label key={sprint.id} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" disabled={createMs.isPending} aria-label={`Include Sprint ${sprint.number}`} checked={!newExcludedSprintIds.includes(sprint.id)} onChange={e => setNewExcludedSprintIds(ids => e.target.checked ? ids.filter(id => id !== sprint.id) : [...ids, sprint.id])} />
              Sprint {sprint.number}
            </label>)}</div>}
          </fieldset>
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={() => { if (newName.trim()) createMs.mutate({ name: newName, excludedSprintIds: newExcludedSprintIds }); }}
              disabled={!newName.trim() || createMs.isPending || sprintsLoading || sprintsError}
              aria-label="Save new milestone"
              title="Save new milestone"
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {createMs.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            </button>
            <button
              type="button"
              onClick={() => { setAddingNew(false); setNewName(""); setNewExcludedSprintIds([]); }}
              disabled={createMs.isPending}
              aria-label="Cancel new milestone"
              title="Cancel"
              className="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  teams,
  tasks,
  sprints,
  onEdit,
  onAddTask,
  onOpenTask,
}: {
  project: Project;
  teams: Team[];
  tasks: Task[];
  sprints: Sprint[];
  onEdit: () => void;
  onAddTask: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const STATUS_COLORS: Record<string, string> = {
    not_started: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    needs_review: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };
  const STATUS_LABELS: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    needs_review: "Needs review",
    done: "Done",
  };

  return (
    <div className="bg-card border rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-5 h-5 text-primary shrink-0" />
          <Link href={`/projects/${project.id}`} className="font-semibold text-base truncate hover:text-primary">{project.name}</Link>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
          title="Edit project"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* description */}
      {project.description && (
        <div className="flex gap-2 text-sm text-muted-foreground">
          <AlignLeft className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="leading-snug">{project.description}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <UsersRound className="h-4 w-4 text-primary" />
        {(project as SharedProject).teamIds != null
          ? (project as SharedProject).teamIds!.length
            ? (project as SharedProject).teamIds!.map(id => teams.find(t => t.id === id)).filter((t): t is Team => !!t).map(team => <span key={team.id} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{team.name}</span>)
            : <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Unassigned</span>
          : project.teamId != null && teams.some(t => t.id === project.teamId)
            ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{teams.find(t => t.id === project.teamId)?.name}</span>
            : <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">Unassigned</span>}
      </div>

      {/* timeline */}
      {project.timeline && (
        <div className="flex gap-2 text-sm text-muted-foreground">
          <CalendarDays className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{project.timeline}</span>
        </div>
      )}

      {/* milestones */}
      <MilestoneManager project={project} />

      {/* tasks */}
      <div className="border-t pt-3 flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Tasks ({tasks.length})
        </p>
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No tasks yet</p>
        ) : (
          tasks.map(task => (
            <button
              key={task.id}
              onClick={() => onOpenTask(task)}
              className={`flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-muted transition-colors group ${
                task.isBlocked ? "border border-red-500" : ""
              }`}
            >
              {task.isBlocked && <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-500 shrink-0" />}
              <span className="text-sm truncate flex-1">{task.title}</span>
              {task.sprintId != null && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300 font-medium shrink-0">
                  Sprint {sprints.find(sprint => sprint.id === task.sprintId)?.number ?? ""}
                </span>
              )}
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[task.status] ?? ""}`}
              >
                {STATUS_LABELS[task.status] ?? task.status}
              </span>
              <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* add task */}
      <Button variant="outline" size="sm" className="w-full gap-2 mt-auto" onClick={onAddTask}>
        <Plus className="w-3.5 h-3.5" />
        Add task
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskFormProjectId, setTaskFormProjectId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sprintFilter, setSprintFilter] = useState<SprintFilterValue>("current");
  const { toast } = useToast();

  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } = useQuery<SharedProject[]>({
    queryKey: ["/api/projects"],
  });
  const { data: teams = [] } = useQuery<Team[]>({ queryKey: ["/api/teams"] });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/sprints"],
  });
  const { data: sprintSettings } = useQuery<TrackerSettings>({
    queryKey: ["/api/sprint-settings"],
  });

  const sprintFilteredTasks = allTasks.filter(t =>
    taskMatchesSprint(t, sprintFilter, sprintSettings?.currentSprintId),
  );
  const projectsInSprint = sprintFilter === "all"
    ? projects
    : projects.filter(project => sprintFilteredTasks.some(task => task.projectId === project.id));

  // Search filtering: match on a project name OR a task title in the selected sprint view.
  const searchLower = searchQuery.trim().toLowerCase();
  const visibleProjects = searchLower
    ? projectsInSprint.filter(p => {
        if (p.name.toLowerCase().includes(searchLower)) return true;
        return sprintFilteredTasks.some(
          t => t.projectId === p.id && t.title.toLowerCase().includes(searchLower),
        );
      })
    : projectsInSprint;

  // Suggestions are scoped to the selected sprint view.
  const searchSuggestions = [
    ...projectsInSprint.map(p => p.name),
    ...sprintFilteredTasks.map(t => t.title),
  ];

  function openAddTask(projectId: number) {
    setTaskFormProjectId(projectId);
    setTaskFormOpen(true);
  }

  function closeTaskForm() {
    setTaskFormOpen(false);
    setTaskFormProjectId(null);
  }

  return (
    <div className="h-screen flex bg-background">
      <AppSidebar
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        activePage="projects"
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                title="Open sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">Projects</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-muted-foreground mr-2">{user?.displayName}</span>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link href="/history">
              <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="Citation History">
                <BookOpen className="w-4 h-4" />
              </button>
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin">
                <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="Admin">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
            )}
            <button
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <LivePresence />
        </header>

        <div className="px-6 py-3 border-b flex items-center gap-3 shrink-0 flex-wrap">
          <Button size="sm" className="gap-2" onClick={() => setProjectFormOpen(true)}>
            <Plus className="w-4 h-4" />
            New project
          </Button>
          <SprintFilterSelect
            value={sprintFilter}
            onValueChange={setSprintFilter}
            sprints={sprints}
            testId="select-sprint-filter"
          />
          <SearchBar
            data-testid="input-project-search"
            value={searchQuery}
            onChange={setSearchQuery}
            suggestions={searchSuggestions}
            placeholder="Search projects & tasks…"
            widthClass="w-64 ml-auto"
          />
        </div>

        <div className="flex-1 overflow-auto p-6">
          {projectsLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : projectsError ? (
            <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
              <p className="text-sm text-destructive">Projects couldn’t be loaded.</p>
              <Button className="mt-3" variant="outline" size="sm" onClick={() => refetchProjects()}>Try again</Button>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <FolderOpen className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {searchQuery
                  ? `No projects match "${searchQuery}" in this sprint view.`
                  : sprintFilter !== "all"
                    ? "No projects have tasks in this sprint view."
                    : "No projects yet. Create one to get started."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleProjects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  teams={teams}
                  tasks={sprintFilteredTasks.filter(t => t.projectId === project.id)}
                  sprints={sprints}
                  onEdit={() => setEditProject(project)}
                  onAddTask={() => openAddTask(project.id)}
                  onOpenTask={task => setLocation(`/tasks/${task.id}?from=projects`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* project dialogs */}
      {projectFormOpen && (
        <ProjectFormDialog open onClose={() => setProjectFormOpen(false)} />
      )}
      {editProject && (
        <ProjectFormDialog open onClose={() => setEditProject(null)} project={editProject} />
      )}

      {/* task dialogs */}
      {taskFormOpen && (
        <TaskFormDialog
          open
          onClose={closeTaskForm}
          defaultProjectId={taskFormProjectId ?? undefined}
        />
      )}
    </div>
  );
}
