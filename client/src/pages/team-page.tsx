import { useEffect, useState } from "react";
import { LivePresence } from "@/lib/live";
import { RemoteUpdateNotice, useRemoteUpdate } from "@/components/remote-update-notice";
import { useRoute, useLocation, Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, FolderOpen, Loader2, Plus, Save, UsersRound, X } from "lucide-react";
import type { Project, Team } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type SharedProject = Project & { teamIds?: number[]; teamId?: number | null };
type Member = { id: number; displayName: string; teamId: number | null };
type TeamDetails = Team & { socialContract?: string };

export default function TeamPage() {
  const [, params] = useRoute("/teams/:id");
  const [, setLocation] = useLocation();
  const teamId = Number(params?.id);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [teamId]);
  const teamQuery = useQuery<TeamDetails>({
    queryKey: ["/api/teams", teamId],
    queryFn: () => apiRequest("GET", `/api/teams/${teamId}`).then(r => r.json()),
    enabled: Number.isInteger(teamId) && teamId > 0,
    retry: false,
  });
  const projectsQuery = useQuery<SharedProject[]>({ queryKey: ["/api/projects"] });
  const remote = useRemoteUpdate(teamQuery.data?.socialContract, editing);
  const membersQuery = useQuery<Member[]>({ queryKey: ["/api/users"] });
  useEffect(() => {
    if (teamQuery.data?.id === teamId && !editing) setDraft(teamQuery.data.socialContract ?? "");
  }, [teamQuery.data, editing, teamId]);
  const invalidateMembership = (projectId: number) => {
    queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "milestones"] });
    queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
    queryClient.invalidateQueries({ queryKey: ["/api/teams", teamId] });
    queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
  };
  const addProject = useMutation({
    mutationFn: (projectId: number) => apiRequest("PUT", `/api/teams/${teamId}/projects/${projectId}`).then(r => r.json()),
    onSuccess: (_result, projectId) => { invalidateMembership(projectId); toast({ title: "Project added to team" }); },
    onError: (error: Error) => toast({ title: "Could not add project", description: error.message, variant: "destructive" }),
  });
  const removeProject = useMutation({
    mutationFn: (projectId: number) => apiRequest("DELETE", `/api/teams/${teamId}/projects/${projectId}`).then(r => r.json()),
    onSuccess: (_result, projectId) => { invalidateMembership(projectId); toast({ title: "Project removed from team" }); },
    onError: (error: Error) => toast({ title: "Could not remove project", description: error.message, variant: "destructive" }),
  });
  const saveContract = useMutation({
    mutationFn: (socialContract: string) => apiRequest("PATCH", `/api/teams/${teamId}`, { socialContract }).then(r => r.json()),
    onSuccess: updated => {
      queryClient.setQueryData(["/api/teams", updated.id], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      if (updated.id === teamId) setEditing(false);
      toast({ title: "Social contract saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save social contract", description: error.message, variant: "destructive" }),
  });

  if (!Number.isInteger(teamId) || teamId < 1) return <TeamUnavailable onBack={() => setLocation("/team-overview")} notFound />;
  if (teamQuery.isLoading) return <main className="min-h-[100dvh] bg-muted/20 p-5 sm:p-8"><div className="mx-auto max-w-4xl animate-pulse space-y-4"><div className="h-8 w-1/3 rounded bg-muted"/><div className="h-44 rounded-xl bg-muted"/><div className="h-48 rounded-xl bg-muted"/></div></main>;
  if (teamQuery.isError || !teamQuery.data) {
    const missing = teamQuery.error instanceof Error && /not found/i.test(teamQuery.error.message);
    return <TeamUnavailable onBack={() => setLocation("/team-overview")} notFound={missing} retry={missing ? undefined : () => teamQuery.refetch()} />;
  }

  const team = teamQuery.data;
  const projects = projectsQuery.data ?? [];
  const linked = projects.filter(project => (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).includes(teamId));
  const available = projects.filter(project => !linked.some(item => item.id === project.id));
  const members = (membersQuery.data ?? []).filter(member => member.teamId === teamId).sort((a, b) => a.displayName.localeCompare(b.displayName));

  return <div className="min-h-[100dvh] bg-muted/20">
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/team-overview")}><ArrowLeft className="mr-2 h-4 w-4"/>Team Overview</Button>
        <span className="text-xs text-muted-foreground">Shared team workspace</span>
        <LivePresence />
      </div>
    </header>
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-7 sm:px-6 sm:py-10">
      <section className="rounded-2xl border bg-card p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Team workspace · #{team.id}</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight sm:text-4xl">{team.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Projects can be shared across teams; adding or removing one here changes only this team’s link.</p>
      </section>
      <section className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="mb-4 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Working agreement</p><h2 className="mt-1 break-words text-xl font-semibold">Social contract</h2></div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {editing ? <>
                  <Button variant="ghost" size="sm" disabled={saveContract.isPending} onClick={() => { setDraft(team.socialContract ?? ""); setEditing(false); }}><X className="mr-1.5 h-4 w-4"/>Cancel</Button>
                  <Button size="sm" disabled={saveContract.isPending} onClick={() => saveContract.mutate(draft)}>{saveContract.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin"/> : <Save className="mr-1.5 h-4 w-4"/>}Save</Button>
                </> : <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit contract</Button>}
              </div>
            </div>
            <RemoteUpdateNotice changed={remote.changed} reload={() => { setDraft(team.socialContract ?? ""); remote.accept(); }} />
            {editing ? <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <div className="min-w-0"><p className="mb-2 text-xs font-medium text-muted-foreground">Markdown</p><Textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={saveContract.isPending} rows={11} className="min-w-0 resize-y font-mono text-sm leading-6" placeholder="How do we work together? Add principles, expectations, and rituals." aria-label="Social contract Markdown"/></div>
              <div className="min-w-0"><p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p><Markdown value={draft} empty="Your preview will appear here."/></div>
            </div> : <Markdown value={team.socialContract ?? ""} empty="No social contract yet. Add shared principles and expectations for this team."/>}
          </section>
          <section className="rounded-xl border bg-card p-5 sm:p-6">
            <div className="mb-4 flex items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Shared delivery</p><h2 className="mt-1 text-xl font-semibold">Projects <span className="text-muted-foreground">({linked.length})</span></h2></div><Link href="/projects" className="text-sm text-primary hover:underline">All projects</Link></div>
            {projectsQuery.isLoading ? <div className="h-24 animate-pulse rounded-lg bg-muted"/> : projectsQuery.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">Projects couldn’t be loaded. <button className="underline" onClick={() => projectsQuery.refetch()}>Retry</button></div> : linked.length === 0 ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No projects linked yet. You can add any project below.</div> : <div className="divide-y rounded-lg border">
              {linked.map(project => <div key={project.id} className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
                <FolderOpen className="h-4 w-4 shrink-0 text-primary"/>
                <Link href={`/projects/${project.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">{project.name}</Link>
                <Button variant="ghost" size="sm" disabled={removeProject.isPending} onClick={() => removeProject.mutate(project.id)} aria-label={`Remove ${project.name} from ${team.name}`}>Remove</Button>
              </div>)}
            </div>}
            <div className="mt-5 border-t pt-4">
              <h3 className="mb-2 text-sm font-semibold">Add an existing project</h3>
              {projectsQuery.isLoading ? <div className="h-10 animate-pulse rounded bg-muted" aria-label="Loading projects"/> : projectsQuery.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Projects couldn’t be loaded. <button className="underline" onClick={() => projectsQuery.refetch()}>Retry</button></div> : available.length === 0 ? <p className="text-sm text-muted-foreground">{projects.length === 0 ? "No projects yet. Create one in the Projects workspace." : "Every project is already linked to this team."}</p> : <div className="max-h-52 space-y-1 overflow-y-auto">{available.map(project => <div key={project.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/60">
                <span className="min-w-0 flex-1 truncate text-sm">{project.name}</span><Button size="sm" variant="outline" disabled={addProject.isPending} aria-label={`Add ${project.name} to ${team.name}`} onClick={() => addProject.mutate(project.id)}><Plus className="mr-1 h-3.5 w-3.5"/>Add</Button>
              </div>)}</div>}
            </div>
          </section>
        </div>
        <aside className="h-fit rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-primary"/><h2 className="font-semibold">Members</h2></div>
          {membersQuery.isLoading ? <div className="mt-4 h-16 animate-pulse rounded bg-muted"/> : membersQuery.isError ? <p className="mt-3 text-sm text-destructive">Members couldn’t be loaded. <button className="underline" onClick={() => membersQuery.refetch()}>Retry</button></p> : members.length === 0 ? <p className="mt-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No members have joined this team yet.</p> : <ul className="mt-4 divide-y">{members.map(member => <li key={member.id} className="break-words py-3 text-sm">{member.displayName}</li>)}</ul>}
          <p className="mt-3 text-xs text-muted-foreground">Member listings follow each person’s current team membership.</p>
        </aside>
      </section>
    </main>
  </div>;
}

function Markdown({ value, empty }: { value: string; empty: string }) {
  return <article className="min-h-44 min-w-0 max-w-none overflow-hidden rounded-xl border bg-muted/15 p-4 text-sm [overflow-wrap:anywhere] prose prose-slate prose-sm dark:prose-invert prose-p:whitespace-pre-wrap prose-p:leading-7 prose-pre:max-w-full prose-pre:overflow-x-auto prose-table:block prose-table:max-w-full prose-table:overflow-x-auto">
    {value.trim() ? <ReactMarkdown>{value}</ReactMarkdown> : <p className="not-prose text-muted-foreground">{empty}</p>}
  </article>;
}

function TeamUnavailable({ onBack, notFound, retry }: { onBack: () => void; notFound: boolean; retry?: () => void }) {
  return <main className="grid min-h-[100dvh] place-items-center bg-muted/20 p-6"><div className="max-w-md text-center">
    <UsersRound className="mx-auto h-10 w-10 text-muted-foreground/40"/><h1 className="mt-4 text-xl font-semibold">{notFound ? "Team not found" : "Team unavailable"}</h1>
    <p className="mt-2 text-sm text-muted-foreground">{notFound ? "This team may have been removed or the address may be incorrect." : "We couldn’t load this team workspace."}</p>
    <div className="mt-5 flex justify-center gap-2">{retry && <Button variant="outline" onClick={retry}>Try again</Button>}<Button onClick={onBack}>Team Overview</Button></div>
  </div></main>;
}