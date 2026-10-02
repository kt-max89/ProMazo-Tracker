import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Link, useLocation } from "wouter";
import {
  BookOpen,
  FolderOpen,
  Loader2,
  LogOut,
  Moon,
  Pin,
  PanelLeft,
  Plus,
  Settings,
  Sun,
  UsersRound,
  Zap,
  ClipboardCheck,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, SprintReflection, TeamPost, Team } from "@shared/schema";
import type { Sprint, TrackerSettings } from "@shared/schema";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReflectionDialog } from "@/components/reflection-dialog";
import { ReflectionDetailDialog } from "@/components/reflection-detail-dialog";
import { ReflectionsTable } from "@/components/reflections-table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type TeamProject = Project & { teamIds?: number[]; teamId?: number | null };
type TeamMember = { id: number; displayName: string; teamId: number | null };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function TeamOverviewPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [showAll, setShowAll] = useState(false);
  const [body, setBody] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const addUpdateRef = useRef<HTMLButtonElement>(null);
  const restoreComposerFocus = useRef(false);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [selectedReflection, setSelectedReflection] = useState<SprintReflection | null>(null);
  const [postToDelete, setPostToDelete] = useState<TeamPost | null>(null);
  const [teamName, setTeamName] = useState("");
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);

  const postsQuery = useQuery<TeamPost[]>({
    queryKey: ["/api/team-posts", showAll],
    queryFn: () => apiRequest("GET", `/api/team-posts${showAll ? "?all=true" : ""}`).then(r => r.json()),
  });
  const projectsQuery = useQuery<TeamProject[]>({
    queryKey: ["/api/projects"],
  });
  const teamsQuery = useQuery<Team[]>({ queryKey: ["/api/teams"] });
  const membersQuery = useQuery<TeamMember[]>({
    queryKey: ["/api/users"],
    refetchInterval: 30_000,
  });
  const sprintsQuery = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });
  const sprintSettingsQuery = useQuery<TrackerSettings>({ queryKey: ["/api/sprint-settings"], refetchInterval: 30_000 });
  const membershipMutation = useMutation({
    mutationFn: (teamId: number | null) => apiRequest("PATCH", "/api/teams/membership", { teamId }).then(r => r.json()),
    onSuccess: (updated: any) => {
      queryClient.setQueryData(["/api/auth/me"], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: updated.teamId == null ? "You left the team" : "Team membership updated" });
    },
    onError: (err: any) => toast({ title: "Could not update membership", description: err.message, variant: "destructive" }),
  });
  const createTeamMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/teams", { name: teamName.trim(), projectIds: selectedProjectIds }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/teams"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setTeamName(""); setSelectedProjectIds([]); setWizardStep(0);
      toast({ title: "Team workspace created" });
    },
    onError: (err: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Could not create team", description: err.message, variant: "destructive" });
    },
  });
  const currentSprintMutation = useMutation({
    mutationFn: (sprintId: number) => apiRequest("PATCH", "/api/sprint-settings/current", { sprintId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sprint-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
      toast({ title: "Current sprint updated" });
    },
    onError: (err: any) => toast({ title: "Could not update current sprint", description: err.message, variant: "destructive" }),
  });
  const nextSprintMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/sprints/next").then(r => r.json() as Promise<Sprint>),
    onSuccess: (sprint) => {
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
      queryClient.invalidateQueries({ queryKey: ["/api/milestones"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", "archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
      toast({ title: `Sprint ${sprint.number} added` });
    },
    onError: (err: any) => toast({ title: "Could not create sprint", description: err.message, variant: "destructive" }),
  });
  const reflectionsQuery = useQuery<SprintReflection[]>({
    queryKey: ["/api/reflections/recent"],
  });

  const createMutation = useMutation({
    mutationFn: (postBody: string) =>
      apiRequest("POST", "/api/team-posts", { body: postBody }).then(r => r.json()),
    onSuccess: () => {
      setBody("");
      setComposerOpen(false);
      restoreComposerFocus.current = true;
      queryClient.invalidateQueries({ queryKey: ["/api/team-posts"] });
      toast({ title: "Post published" });
    },
    onError: (err: any) => {
      toast({ title: "Could not publish post", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (restoreComposerFocus.current && !composerOpen && !createMutation.isPending) {
      addUpdateRef.current?.focus();
      restoreComposerFocus.current = false;
    }
  }, [composerOpen, createMutation.isPending]);

  const pinMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/team-posts/${id}/pin`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-posts"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not update pin", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("DELETE", `/api/team-posts/${id}`).then(r => r.json()),
    onSuccess: () => {
      setPostToDelete(null);
      queryClient.invalidateQueries({ queryKey: ["/api/team-posts"] });
      toast({ title: "Post deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete post", description: err.message, variant: "destructive" });
    },
  });

  function submitPost(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || createMutation.isPending) return;
    createMutation.mutate(trimmed);
  }

  return (
    <div className="min-h-[100dvh] flex bg-background" data-testid="team-overview-page">
      <AppSidebar open={sidebarOpen} onToggle={setSidebarOpen} activePage="team-overview" />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b px-3 py-2.5 sm:px-6 sm:py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {!sidebarOpen && (
              <button
                data-testid="button-open-sidebar"
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                title="Open sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            <UsersRound className="w-5 h-5 text-primary" />
            <h1 className="truncate font-semibold text-base sm:text-lg">Team Overview</h1>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 sm:gap-2">
            <span className="hidden text-sm text-muted-foreground sm:mr-2 sm:inline">{user?.displayName}</span>
            <button onClick={toggleTheme} className="rounded-lg p-1.5 hover:bg-muted transition-colors sm:p-2" title="Toggle theme">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link href="/history">
              <button className="rounded-lg p-1.5 hover:bg-muted transition-colors sm:p-2" title="Citation History">
                <BookOpen className="w-4 h-4" />
              </button>
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin">
                <button className="rounded-lg p-1.5 hover:bg-muted transition-colors sm:p-2" title="Admin">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
            )}
            <button
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="rounded-lg p-1.5 hover:bg-muted transition-colors sm:p-2"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
            <section className="rounded-xl border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div><p className="text-xs font-semibold uppercase tracking-[.15em] text-primary">Shared tracker setting</p><h2 className="mt-1 font-semibold">Current sprint</h2></div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Select disabled={sprintSettingsQuery.isLoading||sprintSettingsQuery.isError||currentSprintMutation.isPending||(sprintsQuery.data?.length??0)===0} value={sprintSettingsQuery.data?.currentSprintId != null ? String(sprintSettingsQuery.data.currentSprintId) : undefined} onValueChange={value => {
                    const id = Number(value); const sprint = sprintsQuery.data?.find(item => item.id === id);
                    if (sprint && id !== sprintSettingsQuery.data?.currentSprintId && window.confirm(`Set Sprint ${sprint.number} as the current sprint for everyone?`)) currentSprintMutation.mutate(id);
                  }}>
                    <SelectTrigger className="w-40" aria-label="Current sprint">{currentSprintMutation.isPending?<span className="text-xs text-muted-foreground">Updating…</span>:<SelectValue placeholder={sprintSettingsQuery.isLoading||sprintsQuery.isLoading?"Loading…":"Select sprint"}/>}</SelectTrigger>
                    <SelectContent>{(sprintsQuery.data ?? []).map(sprint=><SelectItem key={sprint.id} value={String(sprint.id)}>Sprint {sprint.number}</SelectItem>)}</SelectContent>
                  </Select>
                  {sprintsQuery.isError && <Button size="sm" variant="ghost" onClick={()=>sprintsQuery.refetch()}>Retry sprints</Button>}
                  {sprintSettingsQuery.isError && <Button size="sm" variant="ghost" onClick={()=>sprintSettingsQuery.refetch()}>Retry sprint settings</Button>}
                  <Button variant="outline" size="sm" onClick={()=>nextSprintMutation.mutate()} disabled={nextSprintMutation.isPending}>
                    {nextSprintMutation.isPending?<Loader2 className="mr-1.5 h-4 w-4 animate-spin"/>:<Plus className="mr-1.5 h-4 w-4"/>}
                    Add Sprint {(sprintsQuery.data?.[sprintsQuery.data.length-1]?.number ?? 67)+1}
                  </Button>
                </div>
              </div>
            </section>
            <section className="rounded-xl border bg-card p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-primary">Shared workspace</p><h2 className="mt-1 text-xl font-semibold">Teams</h2><p className="mt-1 text-sm text-muted-foreground">Organize projects and colleagues. Every workspace remains visible to everyone.</p></div>
                <Button size="sm" onClick={()=>{setTeamName("");setSelectedProjectIds([]);setWizardStep(1);}}><Plus className="mr-1.5 h-4 w-4"/>Create team</Button>
              </div>
              {teamsQuery.isLoading ? (
                <div className="mt-5 h-20 animate-pulse rounded-lg bg-muted" />
              ) : teamsQuery.isError ? (
                <div className="mt-5 rounded-lg border border-destructive/30 p-4 text-sm text-destructive">
                  Couldn’t load teams. <button className="underline" onClick={() => teamsQuery.refetch()}>Retry</button>
                </div>
              ) : (teamsQuery.data?.length ?? 0) === 0 ? (
                <div className="mt-5 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  No teams yet. Start a workspace for a group of colleagues.
                </div>
              ) : (
                <div className="mt-5 divide-y rounded-lg border">
                  {teamsQuery.data?.map(team => {
                    const members = (membersQuery.data ?? [])
                      .filter(member => member.teamId === team.id)
                      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.id - b.id);
                    return (
                      <div key={team.id} className="flex flex-wrap items-start gap-3 px-4 py-3" data-testid={`team-row-${team.id}`}>
                        <div className="min-w-0 flex-1">
                           <Link href={`/teams/${team.id}`} className="inline-flex items-center gap-1 break-words font-medium hover:text-primary">{team.name}<ChevronRight className="h-3.5 w-3.5"/></Link>
                           <p className="text-xs text-muted-foreground">Open workspace</p>
                          <p className="text-xs text-muted-foreground">
                             {projectsQuery.data?.filter(project => (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).includes(team.id)).length ?? 0} projects
                          </p>
                          <div className="mt-2 text-sm" data-testid={`team-members-${team.id}`}>
                            {membersQuery.isLoading ? (
                              <p className="text-muted-foreground">Loading members…</p>
                            ) : membersQuery.isError ? (
                              <p className="text-destructive">
                                Couldn’t load members. <button className="underline" onClick={() => membersQuery.refetch()}>Retry</button>
                              </p>
                            ) : (
                              <>
                                <p className="text-xs font-medium text-muted-foreground">
                                  {members.length} {members.length === 1 ? "member" : "members"}
                                </p>
                                {members.length === 0 ? (
                                  <p className="mt-1 text-muted-foreground">No members yet.</p>
                                ) : (
                                  <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`${team.name} members`}>
                                    {members.map(member => (
                                      <li key={member.id} className="max-w-full break-words rounded-md bg-muted px-2 py-1 text-xs">
                                        {member.displayName}
                                        {member.id === user?.id && <span className="text-muted-foreground"> (you)</span>}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        {user?.teamId === team.id ? (
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Your team</span>
                        ) : (
                          <Button size="sm" variant="outline" disabled={membershipMutation.isPending} onClick={() => membershipMutation.mutate(team.id)}>
                            Join team
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {user?.teamId != null && <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4"><span className="text-sm text-muted-foreground">Current membership</span><span className="font-medium">{teamsQuery.data?.find(t=>t.id===user.teamId)?.name ?? "Your team"}</span><Button variant="ghost" size="sm" disabled={membershipMutation.isPending} onClick={()=>membershipMutation.mutate(null)}>Leave team</Button></div>}
               {wizardStep > 0 && <div className="mt-5 rounded-xl border bg-muted/20 p-4 sm:p-5">
                 <p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Create team · {wizardStep === 1 ? "1 / 2" : "2 / 2"}</p>
                 {wizardStep === 1 ? <div className="mt-3 space-y-4">
                   <label className="block text-sm font-medium">Team name<Input autoFocus className="mt-2" value={teamName} onChange={e=>setTeamName(e.target.value)} placeholder="e.g. Platform delivery" onKeyDown={e=>{if(e.key==="Enter"&&teamName.trim())setWizardStep(2);}}/></label>
                   <div className="flex justify-end gap-2"><Button variant="ghost" onClick={()=>setWizardStep(0)}>Cancel</Button><Button disabled={!teamName.trim()} onClick={()=>setWizardStep(2)}>Continue</Button></div>
                 </div> : <div className="mt-3 space-y-4">
                   <fieldset disabled={createTeamMutation.isPending}>
                     <legend className="font-medium">Link projects (optional)</legend>
                     <p className="mt-1 text-sm text-muted-foreground">Projects already linked to other teams can be shared here. Their other links and tasks stay unchanged.</p>
                     {projectsQuery.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading projects…</p> : projectsQuery.isError ? <p className="mt-3 text-sm text-destructive">Projects couldn’t be loaded. <button className="underline" onClick={()=>projectsQuery.refetch()}>Retry</button></p> : <div className="mt-3 max-h-48 space-y-1 overflow-auto rounded-lg border bg-background p-2">
                       {(projectsQuery.data??[]).length === 0 ? <p className="p-3 text-sm text-muted-foreground">No projects yet. You can add projects later.</p> : (projectsQuery.data??[]).map(project=><label key={project.id} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-muted"><input type="checkbox" checked={selectedProjectIds.includes(project.id)} onChange={e=>setSelectedProjectIds(ids=>e.target.checked?[...ids,project.id]:ids.filter(id=>id!==project.id))}/><span className="break-words">{project.name}</span></label>)}
                     </div>}
                   </fieldset>
                   <div className="flex flex-wrap justify-between gap-2"><Button variant="ghost" disabled={createTeamMutation.isPending} onClick={()=>setWizardStep(1)}>Back</Button><div className="flex gap-2"><Button variant="ghost" disabled={createTeamMutation.isPending} onClick={()=>setWizardStep(0)}>Cancel</Button><Button disabled={createTeamMutation.isPending||projectsQuery.isLoading||projectsQuery.isError} onClick={()=>createTeamMutation.mutate()}>{createTeamMutation.isPending?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:null}Create team</Button></div></div>
                 </div>}
               </div>}
            </section>
            <section className="space-y-3" aria-labelledby="team-updates-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="team-updates-heading" className="text-lg font-semibold">Team updates</h2>
                <div className="flex flex-wrap items-center gap-3">
                  {showAll && (
                    <button
                      className="text-sm text-primary hover:underline"
                      onClick={() => setShowAll(false)}
                      data-testid="button-show-fewer-posts"
                    >
                      Show fewer
                    </button>
                  )}
                  <Button
                    ref={addUpdateRef}
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-expanded={composerOpen}
                    aria-controls="team-update-composer"
                    data-testid="button-add-team-update"
                    disabled={createMutation.isPending}
                    onClick={() => setComposerOpen(open => !open)}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    Add an update
                  </Button>
                </div>
              </div>
              {composerOpen && (
                <form id="team-update-composer" onSubmit={submitPost} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
                  <div>
                    <h3 id="team-update-composer-heading" className="font-semibold">What’s happening?</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Share a Markdown update with the whole team.
                    </p>
                  </div>
                  <Textarea
                    autoFocus
                    aria-labelledby="team-update-composer-heading"
                    data-testid="input-team-post"
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    placeholder="Share an update… Markdown is supported."
                    rows={4}
                    disabled={createMutation.isPending}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">Posts are shared with everyone on the team.</span>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!body.trim() || createMutation.isPending}
                      data-testid="button-publish-team-post"
                    >
                      {createMutation.isPending
                        ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                      Publish
                    </Button>
                  </div>
                </form>
              )}
              {postsQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : postsQuery.isError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
                  We couldn’t load team updates. Please refresh and try again.
                </div>
              ) : postsQuery.data?.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No team updates yet. Be the first to share one.
                </div>
              ) : (
                <div className="space-y-3">
                  {postsQuery.data?.map(post => (
                    <article key={post.id} className="rounded-xl border bg-card p-5 shadow-sm" data-testid={`team-post-${post.id}`}>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{post.authorName ?? "Deleted user"}</p>
                          <time dateTime={post.createdAt} className="text-xs text-muted-foreground">
                            {formatDateTime(post.createdAt)}
                          </time>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => pinMutation.mutate(post.id)}
                            disabled={pinMutation.isPending}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
                              post.pinned
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted"
                            }`}
                            title={post.pinned ? "Unpin post" : "Pin post"}
                            aria-label={post.pinned ? "Unpin post" : "Pin post"}
                            data-testid={`button-pin-team-post-${post.id}`}
                          >
                            <Pin className={`w-3.5 h-3.5 ${post.pinned ? "fill-current" : ""}`} />
                            {post.pinned ? "Pinned" : "Pin"}
                          </button>
                          {post.authorId === user?.id && (
                            <button
                              onClick={() => setPostToDelete(post)}
                              disabled={deleteMutation.isPending}
                              className="inline-flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                              title="Delete post"
                              aria-label="Delete your post"
                              data-testid={`button-delete-team-post-${post.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-foreground">
                        <ReactMarkdown>{post.body}</ReactMarkdown>
                      </div>
                    </article>
                  ))}
                  {!showAll && postsQuery.data?.length === 5 && (
                    <button
                      className="w-full rounded-lg border border-dashed py-2.5 text-sm text-primary hover:bg-muted/50 transition-colors"
                      onClick={() => setShowAll(true)}
                      data-testid="button-show-all-posts"
                    >
                      Show all posts
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3" aria-labelledby="projects-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="projects-heading" className="text-lg font-semibold">Projects</h2>
                <Link href="/projects">
                  <Button variant="outline" size="sm">Open Projects workspace</Button>
                </Link>
              </div>
              {projectsQuery.isLoading || teamsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : projectsQuery.isError || teamsQuery.isError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
                  We couldn’t load project assignments. <button className="underline" onClick={() => { projectsQuery.refetch(); teamsQuery.refetch(); }}>Try again</button>
                </div>
              ) : projectsQuery.data?.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No projects yet. Open the Projects workspace to create one.
                </div>
              ) : (
                <div className="space-y-4">
                  {[...(teamsQuery.data ?? []).map(team => ({ id: team.id as number | null, name: team.name })), { id: null, name: "Unassigned" }]
                    .filter(group => projectsQuery.data?.some(project => group.id == null
                      ? (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).length === 0
                      : project.teamIds?.includes(group.id) || (project.teamIds == null && project.teamId === group.id)))
                    .map(group => (
                    <div key={group.id ?? "unassigned"} className="overflow-hidden rounded-xl border bg-card">
                      <h3 className="flex items-center justify-between border-b bg-muted/30 px-4 py-2 text-sm font-semibold">
                        {group.id == null ? group.name : <Link href={`/teams/${group.id}`} className="hover:text-primary">{group.name}</Link>}
                        {group.id != null && <Link href={`/teams/${group.id}`} className="text-xs font-medium text-primary hover:underline">Manage team</Link>}
                      </h3>
                      <div className="divide-y">
                  {projectsQuery.data?.filter(project => group.id == null
                    ? (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).length === 0
                    : project.teamIds?.includes(group.id) || (project.teamIds == null && project.teamId === group.id)).map(project => (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <FolderOpen className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-medium text-sm truncate">{project.name}</span>
                      {project.description && (
                        <span className="text-xs text-muted-foreground truncate ml-auto">{project.description}</span>
                      )}
                    </Link>
                  ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3" aria-labelledby="reflections-heading">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 id="reflections-heading" className="text-lg font-semibold flex items-center gap-2">
                    <ClipboardCheck className="h-5 w-5 text-primary" />
                    Sprint reflections
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Review recent sprint learnings and share your own.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href="/reflections">
                    <Button variant="outline" size="sm">See all reflections</Button>
                  </Link>
                  <Button size="sm" onClick={() => setReflectionOpen(true)} data-testid="button-add-reflection">
                    <Plus className="h-3.5 w-3.5 mr-1.5" />
                    Add reflection
                  </Button>
                </div>
              </div>
              {reflectionsQuery.isLoading ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : reflectionsQuery.isError ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">
                  We couldn’t load sprint reflections. Please refresh and try again.
                </div>
              ) : reflectionsQuery.data?.length === 0 ? (
                <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No sprint reflections yet. Submit the first one.
                </div>
              ) : (
                <ReflectionsTable
                  reflections={reflectionsQuery.data ?? []}
                  onSelect={setSelectedReflection}
                />
              )}
            </section>
          </div>
        </main>
      </div>
      <ReflectionDialog open={reflectionOpen} onClose={() => setReflectionOpen(false)} />
      <ReflectionDetailDialog
        reflection={selectedReflection}
        onClose={() => setSelectedReflection(null)}
      />
      <AlertDialog open={postToDelete != null} onOpenChange={open => !open && setPostToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this team update?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes your post from Team Overview. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => postToDelete && deleteMutation.mutate(postToDelete.id)}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-team-post"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete post
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
