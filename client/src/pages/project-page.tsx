import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, CalendarDays, Loader2, Pencil, Plus, Save, X } from "lucide-react";
import type { Project, Task, Team } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { MilestoneManager } from "@/pages/projects-page";
import { useToast } from "@/hooks/use-toast";

type TeamProject = Project & { teamId: number | null };
export default function ProjectPage() {
  const [, params] = useRoute("/projects/:id");
  const [, setLocation] = useLocation();
  const id = Number(params?.id);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [timeline, setTimeline] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const projectQuery = useQuery<TeamProject>({
    queryKey: ["/api/projects", id],
    queryFn: () => apiRequest("GET", `/api/projects/${id}`).then(r => r.json()),
    enabled: Number.isInteger(id) && id > 0,
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const tasksQuery = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const project = projectQuery.data;
  useEffect(() => {
    if (project && !editing) { setName(project.name); setDescription(project.description ?? ""); setTimeline(project.timeline ?? ""); }
  }, [project, editing]);
  const save = useMutation({
    mutationFn: (data: Partial<TeamProject>) => apiRequest("PATCH", `/api/projects/${id}`, data).then(r => r.json()),
    onSuccess: updated => {
      queryClient.setQueryData(["/api/projects", id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setEditing(false); toast({ title: "Project saved" });
    },
    onError: (e: any) => toast({ title: "Could not save project", description: e.message, variant: "destructive" }),
  });
  const assignTeam = useMutation({
    mutationFn: (teamId: number | null) => apiRequest("PATCH", `/api/projects/${id}`, { teamId }).then(r => r.json()),
    onSuccess: (updated: TeamProject) => {
      queryClient.setQueryData(["/api/projects", id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "archived"] });
      toast({ title: updated.teamId == null ? "Project unassigned" : "Project team updated" });
    },
    onError: (e: any) => toast({ title: "Could not update project team", description: e.message, variant: "destructive" }),
  });
  const tasks = (tasksQuery.data ?? []).filter(task => task.projectId === id);
  if (projectQuery.isLoading) return <main className="min-h-[100dvh] bg-background p-8"><div className="mx-auto max-w-4xl animate-pulse space-y-4"><div className="h-10 w-1/2 rounded bg-muted"/><div className="h-48 rounded-xl bg-muted"/></div></main>;
  if (projectQuery.isError || !project) return <main className="min-h-[100dvh] grid place-items-center bg-background p-6"><div className="text-center"><h1 className="text-xl font-semibold">Project unavailable</h1><p className="mt-2 text-muted-foreground">We couldn’t load this workspace.</p><Button className="mt-4" onClick={() => projectQuery.refetch()}>Try again</Button><Button variant="ghost" className="mt-4 ml-2" onClick={() => setLocation("/projects")}>Projects</Button></div></main>;
  return <div className="min-h-[100dvh] bg-muted/25">
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"><div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/projects")}><ArrowLeft className="mr-2 h-4 w-4"/>Projects</Button>
      <div className="flex gap-2">{editing && <Button variant="ghost" size="sm" onClick={() => {setName(project.name);setTimeline(project.timeline??"");setDescription(project.description??"");setEditing(false);}}><X className="mr-1.5 h-4 w-4"/>Cancel</Button>}
        {editing ? <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({name, timeline: timeline || null, description: description || null})}><Save className="mr-1.5 h-4 w-4"/>Save</Button> : <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-1.5 h-4 w-4"/>Edit project</Button>}</div>
    </div></header>
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
      <section className="border-b pb-7">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Project workspace · #{project.id}</p>
        {editing ? <Input value={name} onChange={e=>setName(e.target.value)} aria-label="Project name" className="mt-3 h-auto border-0 bg-transparent px-0 text-4xl font-bold tracking-tight shadow-none focus-visible:ring-0"/> : <h1 className="mt-3 break-words text-4xl font-bold tracking-tight sm:text-5xl">{project.name}</h1>}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4"/>{editing ? <Input aria-label="Timeline" value={timeline} onChange={e=>setTimeline(e.target.value)} placeholder="Timeline" className="h-9 w-52"/> : project.timeline || "No timeline set"}</div>
          <div className="sm:ml-auto w-full sm:w-64">
            <Select disabled={editing || assignTeam.isPending || save.isPending} value={project.teamId == null ? "unassigned" : String(project.teamId)} onValueChange={v=>assignTeam.mutate(v==="unassigned"?null:Number(v))}>
              <SelectTrigger aria-label="Project team"><SelectValue placeholder="Assign to team"/></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned</SelectItem>{(teamsQuery.data??[]).map(team=><SelectItem key={team.id} value={String(team.id)}>{team.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Project brief</p><h2 className="mt-1 text-xl font-semibold">Overview</h2></div>{!editing && <Button size="sm" variant="ghost" onClick={()=>setEditing(true)}><Pencil className="mr-1.5 h-3.5 w-3.5"/>Edit</Button>}</div>
        {editing ? <div className="grid gap-4 lg:grid-cols-2"><div><p className="mb-2 text-xs font-medium text-muted-foreground">Markdown</p><Textarea value={description} onChange={e=>setDescription(e.target.value)} rows={12} className="font-mono text-sm leading-6" placeholder="Describe the project in Markdown…"/></div><div><p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p><article className="prose prose-slate min-h-64 max-w-none rounded-xl border bg-card p-5 dark:prose-invert">{description.trim()?<ReactMarkdown>{description}</ReactMarkdown>:<p className="text-muted-foreground">Your preview will appear here.</p>}</article></div></div>
          : <article className="prose prose-slate max-w-none rounded-xl border bg-card px-5 py-6 dark:prose-invert">{project.description?.trim()?<ReactMarkdown>{project.description}</ReactMarkdown>:<p className="text-muted-foreground">No overview yet. Add a brief to give the team context.</p>}</article>}
      </section>
      <section className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div><div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Delivery</p><h2 className="mt-1 text-xl font-semibold">Tasks <span className="text-muted-foreground">({tasks.length})</span></h2></div><Button size="sm" onClick={()=>setTaskOpen(true)}><Plus className="mr-1.5 h-4 w-4"/>Add task</Button></div>
          {tasksQuery.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-muted"/> : tasksQuery.isError ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Tasks couldn’t be loaded. <button className="underline" onClick={()=>tasksQuery.refetch()}>Try again</button></div> : tasks.length ? <div className="divide-y rounded-xl border bg-card">{tasks.map(task=><button key={task.id} onClick={()=>setLocation(`/tasks/${task.id}?from=project:${id}`)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"><span className="min-w-0 truncate font-medium">{task.title}</span><span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">{task.status.replace("_"," ")}</span></button>)}</div> : <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">A clear first task gives this workspace momentum.</div>}
        </div>
        <aside className="rounded-xl border bg-card p-4"><MilestoneManager project={project}/></aside>
      </section>
    </main>
    {taskOpen&&<TaskFormDialog open onClose={()=>setTaskOpen(false)} defaultProjectId={id}/>}
  </div>;
}