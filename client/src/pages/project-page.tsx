import { useEffect, useRef, useState } from "react";
import { LivePresence } from "@/lib/live";
import { RemoteUpdateNotice, useRemoteUpdate } from "@/components/remote-update-notice";
import { useRoute, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Pencil, Plus, Save, UsersRound, X, Clock3, FileText, Loader2 } from "lucide-react";
import type { Project, Task, Team } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { MilestoneManager } from "@/pages/projects-page";
import { useToast } from "@/hooks/use-toast";
import { ProjectMarkdown } from "@/components/project-markdown";
import { ProjectSprintPlans } from "@/components/project-sprint-plans";
import { DialogHeader } from "@/components/ui/dialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@radix-ui/react-dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@radix-ui/react-select";

type TeamProject = Project & { teamIds?: number[]; teamId?: number | null };
const TASK_STATUS_STYLE: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  needs_review: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
};
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  done: "Done",
};

export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState("");
  const [teamIds, setTeamIds] = useState<number[]>([]);
  const [taskOpen, setTaskOpen] = useState(false);
  const planNavigationGuard = useRef<() => boolean>(() => true);

  const projectQuery = useQuery<TeamProject>({
    queryKey: ["/api/projects", id],
    queryFn: () => apiRequest("GET", `/api/projects/${id}`).then(response => response.json()),
    enabled: Number.isInteger(id) && id > 0,
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const tasksQuery = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const project = projectQuery.data;
  const remote = useRemoteUpdate(project, editing);

  useEffect(() => {
    if (project && !editing) {
      setName(project.name);
      setDescription(project.description ?? "");
      setTimeline(project.timeline ?? "");
      setTeamIds(project.teamIds ?? (project.teamId == null ? [] : [project.teamId]));
    }
  }, [project, editing]);

  const save = useMutation({
    mutationFn: (data: Partial<TeamProject>) => apiRequest("PATCH", `/api/projects/${id}`, data).then(response => response.json()),
    onSuccess: updated => {
      queryClient.setQueryData(["/api/projects", id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", id, "milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setEditing(false);
      toast({ title: "Project saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save project", description: error.message, variant: "destructive" }),
  });

  const tasks = (tasksQuery.data ?? []).filter(task => task.projectId === id);
  if (projectQuery.isLoading) return <main className="min-h-[100dvh] bg-background p-8"><div className="mx-auto max-w-4xl animate-pulse space-y-4"><div className="h-10 w-1/2 rounded bg-muted"/><div className="h-48 rounded-xl bg-muted"/></div></main>;
  if (projectQuery.isError || !project) return <main className="min-h-[100dvh] grid place-items-center bg-background p-6"><div className="text-center"><h1 className="text-xl font-semibold">Project unavailable</h1><p className="mt-2 text-muted-foreground">We couldn’t load this workspace.</p><Button className="mt-4" onClick={() => projectQuery.refetch()}>Try again</Button><Button variant="ghost" className="mt-4 ml-2" onClick={() => setLocation("/projects")}>Projects</Button></div></main>;

  function leaveProject(destination: string) {
    if (!planNavigationGuard.current()) return;
    setLocation(destination);
  }

  return <div className="min-h-[100dvh] bg-muted/25">
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
      <Button variant="ghost" size="sm" onClick={() => leaveProject("/projects")}><ArrowLeft className="mr-2 h-4 w-4"/>Projects</Button>
      <div className="flex gap-2">
        {editing && <Button variant="ghost" size="sm" onClick={() => { setName(project.name); setTimeline(project.timeline ?? ""); setDescription(project.description ?? ""); setTeamIds(project.teamIds ?? (project.teamId == null ? [] : [project.teamId])); setEditing(false); }}><X className="mr-1.5 h-4 w-4"/>Cancel</Button>}
        {editing ? <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ name, timeline: timeline || null, description: description || null, teamIds })}><Save className="mr-1.5 h-4 w-4"/>Save</Button> : <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4"/>Edit project</Button>}
      </div>
      <LivePresence />
    </div></header>
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <RemoteUpdateNotice changed={remote.changed} reload={() => {
        setName(project.name); setDescription(project.description ?? ""); setTimeline(project.timeline ?? "");
        setTeamIds(project.teamIds ?? (project.teamId == null ? [] : [project.teamId])); remote.accept();
      }} />
      <section className="border-b pb-7">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Project workspace · #{project.id}</p>
        {editing ? <Input value={name} onChange={event => setName(event.target.value)} aria-label="Project name" className="mt-3 h-auto border-0 bg-transparent px-0 text-4xl font-bold tracking-tight shadow-none focus-visible:ring-0"/> : <h1 className="mt-3 break-words text-4xl font-bold tracking-tight sm:text-5xl">{project.name}</h1>}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4"/>{editing ? <Input aria-label="Timeline" value={timeline} onChange={event => setTimeline(event.target.value)} placeholder="Timeline" className="h-9 w-52"/> : project.timeline || "No timeline set"}</div>
          <div className="w-full sm:ml-auto sm:max-w-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium"><UsersRound className="h-4 w-4 text-primary"/>Assigned teams</div>
            {teamsQuery.isLoading ? <div className="h-9 animate-pulse rounded-lg bg-muted" aria-label="Loading teams"/> : teamsQuery.isError ? <p className="text-sm text-destructive">Teams couldn’t be loaded. <button className="underline" onClick={() => teamsQuery.refetch()}>Retry</button></p> : editing ? teamsQuery.data?.length ? <div className="grid max-h-32 gap-1 overflow-y-auto rounded-lg border bg-card p-2 sm:grid-cols-2">{teamsQuery.data.map(team => <label key={team.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"><input type="checkbox" checked={teamIds.includes(team.id)} disabled={save.isPending} onChange={event => setTeamIds(ids => event.target.checked ? [...ids, team.id] : ids.filter(id => id !== team.id))}/><span className="truncate">{team.name}</span></label>)}</div> : <p className="text-sm text-muted-foreground">No teams exist yet.</p>
              : <div className="flex flex-wrap gap-1.5">{(teamsQuery.data ?? []).filter(team => teamIds.includes(team.id)).map(team => <span key={team.id} className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{team.name}</span>)}{teamIds.length === 0 && <span className="text-sm text-muted-foreground">No teams assigned</span>}</div>}
          </div>
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Project brief</p><h2 className="mt-1 text-xl font-semibold">Overview</h2></div>{!editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5"/>Edit</Button>}</div>
        {editing ? <div className="grid gap-4 lg:grid-cols-2"><div><p className="mb-2 text-xs font-medium text-muted-foreground">Markdown</p><Textarea value={description} onChange={event => setDescription(event.target.value)} rows={12} className="font-mono text-sm leading-6" placeholder="Describe the project in Markdown…"/></div><div><p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p><div className="min-h-64 overflow-hidden rounded-xl border bg-card p-5">{description.trim() ? <ProjectMarkdown>{description}</ProjectMarkdown> : <p className="text-muted-foreground">Your preview will appear here.</p>}</div></div></div>
          : <div className="rounded-xl border bg-card px-5 py-6">{project.description?.trim() ? <ProjectMarkdown>{project.description}</ProjectMarkdown> : <p className="text-muted-foreground">No overview yet. Add a brief to give the team context.</p>}</div>}
      </section>
      <ProjectSprintPlans key={project.id} project={project} navigationGuardRef={planNavigationGuard} />
      <section className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Delivery</p><h2 className="mt-1 text-xl font-semibold">Tasks <span className="text-muted-foreground">({tasks.length})</span></h2></div><Button size="sm" onClick={() => setTaskOpen(true)}><Plus className="mr-1.5 h-4 w-4"/>Add task</Button></div>
          {tasksQuery.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted"/> : tasksQuery.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Tasks couldn’t be loaded. <button className="underline" onClick={() => tasksQuery.refetch()}>Try again</button></div> : tasks.length ? <div className="divide-y rounded-xl border bg-card">{tasks.map(task => <button key={task.id} onClick={() => leaveProject(`/tasks/${task.id}?from=project:${id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"><span className="min-w-0 truncate font-medium">{task.title}</span><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${TASK_STATUS_STYLE[task.status] ?? "bg-muted text-muted-foreground"}`}>{TASK_STATUS_LABEL[task.status] ?? task.status}</span></button>)}</div> : <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">A clear first task gives this workspace momentum.</div>}
        </div>
        <aside className="rounded-xl border bg-card p-4"><MilestoneManager project={project}/></aside>
      </section>
    </main>
    {taskOpen && <TaskFormDialog open onClose={() => setTaskOpen(false)} defaultProjectId={id}/>}
  </div>;
}