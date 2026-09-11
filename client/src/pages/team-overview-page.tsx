import { useState } from "react";
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
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Project, SprintReflection, TeamPost } from "@shared/schema";
import { ReflectionDialog } from "@/components/reflection-dialog";
import { ReflectionDetailDialog } from "@/components/reflection-detail-dialog";
import { ReflectionsTable } from "@/components/reflections-table";

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
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [selectedReflection, setSelectedReflection] = useState<SprintReflection | null>(null);

  const postsQuery = useQuery<TeamPost[]>({
    queryKey: ["/api/team-posts", showAll],
    queryFn: () => apiRequest("GET", `/api/team-posts${showAll ? "?all=true" : ""}`).then(r => r.json()),
  });
  const projectsQuery = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });
  const reflectionsQuery = useQuery<SprintReflection[]>({
    queryKey: ["/api/reflections/recent"],
  });

  const createMutation = useMutation({
    mutationFn: (postBody: string) =>
      apiRequest("POST", "/api/team-posts", { body: postBody }).then(r => r.json()),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/team-posts"] });
      toast({ title: "Post published" });
    },
    onError: (err: any) => {
      toast({ title: "Could not publish post", description: err.message, variant: "destructive" });
    },
  });

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

  function submitPost(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed || createMutation.isPending) return;
    createMutation.mutate(trimmed);
  }

  return (
    <div className="h-screen flex bg-background" data-testid="team-overview-page">
      <AppSidebar open={sidebarOpen} onToggle={setSidebarOpen} activePage="team-overview" />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
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
            <h1 className="font-semibold text-lg">Team Overview</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2">{user?.displayName}</span>
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted transition-colors" title="Toggle theme">
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
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-4xl mx-auto w-full px-6 py-8 space-y-8">
            <section className="space-y-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">What’s happening?</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Share a Markdown update with the whole team.
                </p>
              </div>
              <form onSubmit={submitPost} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
                <Textarea
                  data-testid="input-team-post"
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Share an update… Markdown is supported."
                  rows={4}
                  disabled={createMutation.isPending}
                />
                <div className="flex items-center justify-between gap-3">
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
            </section>

            <section className="space-y-3" aria-labelledby="team-updates-heading">
              <div className="flex items-center justify-between gap-3">
                <h2 id="team-updates-heading" className="text-lg font-semibold">Team updates</h2>
                {showAll && (
                  <button
                    className="text-sm text-primary hover:underline"
                    onClick={() => setShowAll(false)}
                    data-testid="button-show-fewer-posts"
                  >
                    Show fewer
                  </button>
                )}
              </div>
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
                        <button
                          onClick={() => pinMutation.mutate(post.id)}
                          disabled={pinMutation.isPending}
                          className={`shrink-0 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ${
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
              {projectsQuery.isLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : projectsQuery.data?.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No projects yet. Open the Projects workspace to create one.
                </div>
              ) : (
                <div className="divide-y rounded-xl border bg-card">
                  {projectsQuery.data?.map(project => (
                    <Link
                      key={project.id}
                      href="/projects"
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
    </div>
  );
}