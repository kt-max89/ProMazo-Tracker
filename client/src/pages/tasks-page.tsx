import { useState, useEffect } from "react";
import { LivePresence } from "@/lib/live";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Plus, Loader2, AlertCircle, CheckCircle2, Clock, AlertTriangle,
  RotateCcw, Sun, Moon, LogOut, Zap,
  Settings, BookOpen, PanelLeft, Flag, Folder
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import type { Task, Project, Milestone, Sprint, TrackerSettings, TaskStatus, Team } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { SearchBar } from "@/components/search-bar";
import { TaskCard, getProjectColorClass } from "@/components/task-card";
import { SprintFilterSelect } from "@/components/sprint-filter-select";
import { taskMatchesSprint, type SprintFilterValue } from "@/lib/sprints";

type AppUser = { id: number; displayName: string; email: string };
type SharedProject = Project & { teamIds?: number[]; teamId?: number | null };

const STATUSES = [
  {
    value: "not_started",
    label: "Not started",
    icon: Clock,
    badgeColor: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    columnBg: "bg-slate-50 dark:bg-slate-900/30",
    columnBorder: "border-slate-200 dark:border-slate-800",
    headerColor: "text-slate-600 dark:text-slate-400",
  },
  {
    value: "in_progress",
    label: "In progress",
    icon: AlertCircle,
    badgeColor: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    columnBg: "bg-blue-50 dark:bg-blue-950/30",
    columnBorder: "border-blue-200 dark:border-blue-900",
    headerColor: "text-blue-700 dark:text-blue-400",
  },
  {
    value: "needs_review",
    label: "Needs review",
    icon: Flag,
    badgeColor: "bg-[#FF6F91]/15 text-[#FF6F91] dark:bg-[#FF6F91]/25 dark:text-[#FF6F91]",
    columnBg: "bg-[#FF6F91]/10 dark:bg-[#FF6F91]/10",
    columnBorder: "border-[#FF6F91]/40 dark:border-[#FF6F91]/40",
    headerColor: "text-[#FF6F91]",
  },
  {
    value: "done",
    label: "Done",
    icon: CheckCircle2,
    badgeColor: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    columnBg: "bg-green-50 dark:bg-green-950/30",
    columnBorder: "border-green-200 dark:border-green-900",
    headerColor: "text-green-700 dark:text-green-400",
  },
] as const;

function statusMeta(value: string) {
  return STATUSES.find(s => s.value === value) ?? STATUSES[0];
}


function ArchivedTaskCard({
  task,
  projects,
  milestones,
  onRestore,
}: {
  task: Task;
  projects: Project[];
  milestones: Milestone[];
  onRestore: () => void;
}) {
  const meta = statusMeta(task.status);
  const Icon = meta.icon;
  const project = task.projectId == null
    ? null
    : projects.find(item => item.id === task.projectId);
  const milestone = task.milestoneId == null
    ? null
    : milestones.find(item => item.id === task.milestoneId);
  const projectClass = project ? getProjectColorClass(project.id, projects) : "";

  return (
    <div
      data-testid={`card-archived-task-${task.id}`}
      className="bg-card border rounded-lg p-3 opacity-70"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug line-through text-muted-foreground">
            {task.title}
          </p>
          <p
            className="mt-1 text-xs font-medium text-muted-foreground"
            data-testid={`text-archived-task-id-${task.id}`}
          >
            Task #{task.id}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          data-testid={`button-restore-task-${task.id}`}
          onClick={onRestore}
          className="h-6 px-2 text-xs shrink-0"
        >
          <RotateCcw className="w-3 h-3 mr-1" />
          Restore
        </Button>
      </div>
      {(project || milestone) && (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
          {project && (
            <span
              className={`inline-flex max-w-full items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${projectClass}`}
              data-testid={`badge-project-${task.id}`}
            >
              <Folder className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {milestone && (
            <span
              className="inline-flex max-w-full items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
              data-testid={`badge-milestone-${task.id}`}
            >
              <Flag className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{milestone.name}</span>
            </span>
          )}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.badgeColor}`}>
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
        {task.isBlocked && (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400">
            <AlertTriangle className="w-3 h-3" />
            Blocked
          </span>
        )}
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sprintFilter, setSprintFilter] = useState<SprintFilterValue>("current");
  const [teamScope, setTeamScope] = useState("initial");
  const [scopeInitialized, setScopeInitialized] = useState(false);

  const { data: tasks = [], isLoading, isError: tasksError, refetch: refetchTasks } = useQuery<Task[]>({
    queryKey: showArchived ? ["/api/tasks", "archived"] : ["/api/tasks"],
  });

  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
  });

  const { data: projects = [], isLoading: projectsLoading, isError: projectsError, refetch: refetchProjects } = useQuery<SharedProject[]>({
    queryKey: ["/api/projects"],
  });
  const { data: teams = [], isLoading: teamsLoading, isError: teamsError, refetch: refetchTeams } = useQuery<Team[]>({ queryKey: ["/api/teams"] });

  useEffect(() => {
    if (scopeInitialized || !user || teamsLoading) return;
    setTeamScope(user.teamId != null ? "my-team" : "all");
    setScopeInitialized(true);
  }, [user, scopeInitialized, teamsLoading]);
  useEffect(() => {
    if (teamScope === "initial") return;
    if (projectFilter === "all") return;
    const project = projects.find(item => String(item.id) === projectFilter);
    if (!project) return;
    const memberships = project.teamIds ?? (project.teamId == null ? [] : [project.teamId]);
    const inScope = teamScope === "all"
      || (teamScope === "unassigned" && memberships.length === 0)
      || (teamScope === "my-team" && user?.teamId != null && memberships.includes(user.teamId))
      || (teamScope.startsWith("team:") && memberships.includes(Number(teamScope.slice(5))));
    if (!inScope) setProjectFilter("all");
  }, [teamScope, projects, projectFilter, user?.teamId]);

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/milestones"],
  });
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/sprints"],
  });
  const { data: sprintSettings } = useQuery<TrackerSettings>({
    queryKey: ["/api/sprint-settings"],
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/tasks/${id}/restore`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task restored" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const changeStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TaskStatus }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (err: any) => {
      toast({ title: "Could not move task", description: err.message, variant: "destructive" });
    },
  });

  function handleDrop(taskId: number, newStatus: TaskStatus) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    changeStatusMutation.mutate({ id: taskId, status: newStatus });
  }

  const scopedProjectIds = new Set(projects.filter(project =>
    teamScope === "all" || teamScope === "initial"
      ? true
      : teamScope === "unassigned"
        ? (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).length === 0
        : teamScope === "my-team"
          ? user?.teamId != null && (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).includes(user.teamId)
          : teamScope.startsWith("team:") && (project.teamIds ?? (project.teamId == null ? [] : [project.teamId])).includes(Number(teamScope.slice(5))),
  ).map(project => project.id));
  const scopedTasks = teamScope === "all" || teamScope === "initial"
    ? tasks
    : teamScope === "unassigned"
      ? tasks.filter(task => task.projectId == null || scopedProjectIds.has(task.projectId))
      : tasks.filter(task => task.projectId != null && scopedProjectIds.has(task.projectId));
  const projectFilteredTasks = projectFilter === "all"
    ? scopedTasks
    : scopedTasks.filter(t => t.projectId === parseInt(projectFilter));
  const scopedProjects = projects.filter(project => scopedProjectIds.has(project.id));
  const sprintAndProjectFilteredTasks = projectFilteredTasks.filter(t =>
    taskMatchesSprint(t, sprintFilter, sprintSettings?.currentSprintId),
  );

  const searchLower = searchQuery.trim().toLowerCase();
  const filteredTasks = searchLower
    ? sprintAndProjectFilteredTasks.filter(t => t.title.toLowerCase().includes(searchLower))
    : sprintAndProjectFilteredTasks;

  const byStatus = (status: string) => filteredTasks.filter(t => t.status === status);

  return (
    <div className="h-screen flex bg-background" data-testid="tasks-page">
      <AppSidebar
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        activePage="tasks"
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header data-testid="page-header" className="border-b px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 shrink-0 min-w-0">
          <div data-testid="header-title-group" className="flex min-w-0 flex-1 items-center gap-3">
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
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="min-w-0 break-words font-semibold text-lg">Task Tracker</h1>
          </div>
          <div data-testid="header-account-group" className="ml-auto flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
            <span className="hidden sm:inline min-w-0 max-w-40 break-words text-right text-sm text-muted-foreground mr-2" data-testid="text-tasks-user">{user?.displayName}</span>
            <button
              data-testid="button-toggle-theme-tasks"
              aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
              onClick={toggleTheme}
              className="shrink-0 p-2 rounded-lg hover:bg-muted transition-colors"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link href="/history">
              <button data-testid="link-history-tasks" className="p-2 rounded-lg hover:bg-muted transition-colors" title="Citation History">
                <BookOpen className="w-4 h-4" />
              </button>
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin">
                <button data-testid="link-admin-tasks" className="p-2 rounded-lg hover:bg-muted transition-colors" title="Admin">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
            )}
            <button
              data-testid="button-logout-tasks"
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
            <LivePresence />
          </div>
        </header>

        <div className="px-6 py-3 border-b flex items-center gap-3 shrink-0 flex-wrap">
          <Button
            data-testid="button-new-task"
            onClick={() => setCreateOpen(true)}
            size="sm"
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            New task
          </Button>
          <div className="flex rounded-lg border overflow-hidden text-sm">
            <button
              data-testid="button-view-open"
              onClick={() => setShowArchived(false)}
              className={`px-3 py-1.5 transition-colors ${!showArchived ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              Open
            </button>
            <button
              data-testid="button-view-archived"
              onClick={() => setShowArchived(true)}
              className={`px-3 py-1.5 transition-colors ${showArchived ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            >
              Archived
            </button>
          </div>
          <Select value={teamScope} onValueChange={value => setTeamScope(value)}>
            <SelectTrigger data-testid="select-team-scope" className="h-8 w-40 text-sm"><SelectValue placeholder="Team scope"/></SelectTrigger>
            <SelectContent>
              {user?.teamId != null && <SelectItem value="my-team">My team</SelectItem>}
              {teams.map(team=><SelectItem key={team.id} value={`team:${team.id}`}>{team.name}</SelectItem>)}
              <SelectItem value="all">All teams</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>
            </SelectContent>
          </Select>
          <SprintFilterSelect
            value={sprintFilter}
            onValueChange={setSprintFilter}
            sprints={sprints}
            testId="select-sprint-filter"
          />
          {/* Project filter */}
          {projects.length > 0 && (
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger
                data-testid="select-project-filter"
                className="h-8 text-sm w-48"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {scopedProjects.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Search */}
          <SearchBar
            data-testid="input-task-search"
            value={searchQuery}
            onChange={setSearchQuery}
            suggestions={sprintAndProjectFilteredTasks.map(t => t.title)}
            placeholder="Search tasks…"
            widthClass="w-56 ml-auto"
          />
        </div>

        {/* Split container: board + detail panel side by side */}
        <div className="flex-1 flex overflow-hidden">
          {/* Board / archived area */}
          <div className="flex-1 overflow-auto p-6 transition-all duration-300">
            {isLoading || projectsLoading || teamsLoading || teamScope === "initial" ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : tasksError || projectsError || teamsError ? (
              <div className="mx-auto max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                <p className="text-sm text-destructive">Work couldn’t be loaded. The board is unavailable rather than empty.</p>
                <Button className="mt-3" variant="outline" size="sm" onClick={() => { refetchTasks(); refetchProjects(); refetchTeams(); }}>Try again</Button>
              </div>
            ) : showArchived ? (
              <div>
                {filteredTasks.length === 0 ? (
                  <div className="text-center py-20 text-muted-foreground text-sm">No archived tasks</div>
                ) : (
                  <div className="max-w-xl space-y-2">
                    {filteredTasks.map(task => (
                      <ArchivedTaskCard
                        key={task.id}
                        task={task}
                        projects={projects}
                        milestones={milestones}
                        onRestore={() => restoreMutation.mutate(task.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-4 min-w-[480px] items-start h-full">
                {STATUSES.map(status => {
                  const columnTasks = byStatus(status.value);
                  const Icon = status.icon;
                  const isOver = dragOverColumn === status.value;
                  return (
                    <div
                      key={status.value}
                      data-testid={`column-${status.value}`}
                      className={`flex-1 min-w-0 flex flex-col rounded-xl border-2 transition-colors ${status.columnBg} ${
                        isOver ? "border-primary/60 shadow-md" : status.columnBorder
                      }`}
                      onDragOver={e => { e.preventDefault(); setDragOverColumn(status.value); }}
                      onDragLeave={e => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                          setDragOverColumn(null);
                        }
                      }}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverColumn(null);
                        const taskId = parseInt(e.dataTransfer.getData("taskId"));
                        if (!isNaN(taskId)) handleDrop(taskId, status.value);
                      }}
                    >
                      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${status.headerColor}`} />
                        <span className={`text-sm font-semibold ${status.headerColor}`}>{status.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground bg-white/60 dark:bg-black/20 rounded-full px-2 py-0.5 font-medium">
                          {columnTasks.length}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 px-3 pb-4 min-h-[120px]">
                        {columnTasks.length === 0 ? (
                          <div className={`border-2 border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground/60 transition-colors ${
                            isOver ? "border-primary/40 bg-primary/5" : "border-transparent"
                          }`}>
                            Drop here
                          </div>
                        ) : (
                          columnTasks.map(task => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              users={users}
                              milestones={milestones}
                              projects={projects}
                              sprints={sprints}
                              onClick={() => setEditTask(task)}
                              onDragStart={e => {
                                e.dataTransfer.setData("taskId", String(task.id));
                                e.dataTransfer.effectAllowed = "move";
                                setDraggingTaskId(task.id);
                              }}
                              onDragEnd={() => {
                                setDraggingTaskId(null);
                                setDragOverColumn(null);
                              }}
                            />
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right-side detail panel — slides in when a task is selected */}
          <div
            className={`shrink-0 transition-all duration-300 ease-in-out overflow-x-hidden
              ${editTask ? "w-full sm:w-[420px] lg:w-[480px]" : "w-0"}`}
          >
            {editTask && (
              <TaskDetailPanel
                task={editTask}
                onClose={() => setEditTask(null)}
                onExpand={() => setLocation(`/tasks/${editTask.id}?from=tasks`)}
              />
            )}
          </div>
        </div>
      </div>

      {createOpen && (
        <TaskFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}
