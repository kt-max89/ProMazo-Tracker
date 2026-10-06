import { useState } from "react";
import { LivePresence } from "@/lib/live";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Loader2, LogOut, Moon, PanelLeft, Settings, Sun, UsersRound, LockKeyhole, Plus } from "lucide-react";
import { Link, useLocation } from "wouter";
import type { ReflectionAccess, Sprint, SprintReflection } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { ReflectionDetailDialog } from "@/components/reflection-detail-dialog";
import { ReflectionsTable } from "@/components/reflections-table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/components/theme-provider";
import { apiRequest } from "@/lib/queryClient";
import { ReflectionDialog } from "@/components/reflection-dialog";

type AppUser = { id: number; displayName: string; email: string };

export default function ReflectionsPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [sprintFilter, setSprintFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [selected, setSelected] = useState<SprintReflection | null>(null);
  const [reflectionOpen, setReflectionOpen] = useState(false);
  const [initialSprintId, setInitialSprintId] = useState<number | undefined>();

  const { data: sprints = [] } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const accessQuery = useQuery<ReflectionAccess[]>({ queryKey: ["/api/reflections/access"] });
  const reflectionsQuery = useQuery<SprintReflection[]>({
    queryKey: ["/api/reflections", sprintFilter, personFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (sprintFilter !== "all") params.set("sprintId", sprintFilter);
      if (personFilter !== "all") params.set("authorId", personFilter);
      const query = params.toString();
      return apiRequest("GET", `/api/reflections${query ? `?${query}` : ""}`).then(response => response.json());
    },
  });
  const relevantAccess = (accessQuery.data ?? []).filter(item => sprintFilter === "all" || String(item.sprintId) === sprintFilter);
  const openReflectionForm = (sprintId: number) => {
    setInitialSprintId(sprintId);
    setReflectionOpen(true);
  };

  return (
    <div className="h-screen flex bg-background" data-testid="reflections-page">
      <AppSidebar open={sidebarOpen} onToggle={setSidebarOpen} activePage="team-overview" />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b px-4 sm:px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-muted"
                title="Open sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            <UsersRound className="w-5 h-5 text-primary shrink-0" />
            <h1 className="font-semibold text-lg truncate">Sprint Reflections</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-muted-foreground mr-1">{user?.displayName}</span>
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted" title="Toggle theme">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link href="/history">
              <button className="p-2 rounded-lg hover:bg-muted" title="Citation History">
                <BookOpen className="w-4 h-4" />
              </button>
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin">
                <button className="p-2 rounded-lg hover:bg-muted" title="Admin">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
            )}
            <button
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="p-2 rounded-lg hover:bg-muted"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <LivePresence />
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-6xl mx-auto w-full px-4 sm:px-6 py-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
              <div>
                <Link href="/team-overview" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Team Overview
                </Link>
                <h2 className="text-3xl font-semibold tracking-tight">All sprint reflections</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Select a row to read the complete reflection.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select value={sprintFilter} onValueChange={setSprintFilter}>
                  <SelectTrigger className="w-full sm:w-44" data-testid="filter-reflections-sprint">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sprints</SelectItem>
                    {sprints.map(sprint => (
                      <SelectItem key={sprint.id} value={String(sprint.id)}>Sprint {sprint.number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={personFilter} onValueChange={setPersonFilter}>
                  <SelectTrigger className="w-full sm:w-52" data-testid="filter-reflections-person">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All people</SelectItem>
                    {users.map(person => (
                      <SelectItem key={person.id} value={String(person.id)}>{person.displayName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {accessQuery.isError ? (
              <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                Sprint reflection access could not be loaded. <button className="underline" onClick={() => accessQuery.refetch()}>Retry</button>
              </div>
            ) : relevantAccess.length > 0 && (
              <section className="mb-5 space-y-2" aria-label="Reflection access by sprint" data-testid="reflection-access-status">
                {relevantAccess.map(access => {
                  const sprint = sprints.find(item => item.id === access.sprintId);
                  return (
                    <div key={access.sprintId} className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 items-start gap-2">
                        {!access.canRead && user?.role !== "admin" && <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <div>
                          <p className="text-sm font-medium">Sprint {access.sprintNumber}</p>
                          <p className="text-sm text-muted-foreground">
                            {!access.submitted
                              ? access.canRead || user?.role === "admin"
                                ? "No reflection submitted yet."
                                : "Submit your reflection for this sprint before viewing other people's reflections."
                              : !access.canRead && user?.role !== "admin"
                                ? "This sprint’s reflection is locked until access is granted."
                                : "Reflection submitted."}
                          </p>
                        </div>
                      </div>
                      {!access.submitted && sprint && (
                        <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => openReflectionForm(access.sprintId)} data-testid={`button-submit-reflection-sprint-${access.sprintId}`}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />Submit reflection
                        </Button>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {reflectionsQuery.isLoading ? (
              <div className="flex justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : reflectionsQuery.isError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
                We couldn’t load sprint reflections. Please refresh and try again.
              </div>
            ) : reflectionsQuery.data?.length === 0 ? (
              <div className="rounded-xl border border-dashed p-12 text-center">
                <p className="font-medium">No reflections match these filters</p>
                <p className="text-sm text-muted-foreground mt-1">Try selecting a different sprint or person.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => { setSprintFilter("all"); setPersonFilter("all"); }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <ReflectionsTable reflections={reflectionsQuery.data ?? []} onSelect={setSelected} />
            )}
          </div>
        </main>
      </div>
      <ReflectionDetailDialog reflection={selected} onClose={() => setSelected(null)} />
      <ReflectionDialog
        open={reflectionOpen}
        initialSprintId={initialSprintId}
        onClose={() => setReflectionOpen(false)}
      />
    </div>
  );
}