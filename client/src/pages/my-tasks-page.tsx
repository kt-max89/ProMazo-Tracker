import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Loader2, Sun, Moon, LogOut, Zap, Settings, BookOpen, PanelLeft,
  UserCheck, AlertTriangle, RotateCcw,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Task, Project, Milestone, Sprint, TrackerSettings } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { SearchBar } from "@/components/search-bar";
import { TaskCard } from "@/components/task-card";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { STATUSES } from "@/lib/task-status-meta";
import { SprintFilterSelect } from "@/components/sprint-filter-select";
import { taskMatchesSprint, type SprintFilterValue } from "@/lib/sprints";

type AppUser = { id: number; displayName: string; email: string };

// ── Date bucket logic ────────────────────────────────────────────────────────

const BUCKET_ORDER = [
  "Overdue",
  "This week",
  "This month",
  "Next month",
  "Later this year",
  "Next year",
  "Further out",
  "No due date",
] as const;

type DateBucket = (typeof BUCKET_ORDER)[number];

function getDueDateBucket(task: Task): DateBucket {
  const { dueDate, status } = task;
  if (!dueDate) return "No due date";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);

  if (due < today) {
    // Past date: "Overdue" only for non-done tasks
    if (status !== "done") return "Overdue";
    // Done tasks with past dates: bucket by recency
    const dayOfWeekToday = today.getDay();
    const daysToMonday = dayOfWeekToday === 0 ? 6 : dayOfWeekToday - 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - daysToMonday);
    if (due >= weekStart) return "This week";
    if (due.getMonth() === today.getMonth() && due.getFullYear() === today.getFullYear()) return "This month";
    return "Further out";
  }

  // Today or future
  const dayOfWeek = today.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - daysToMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  if (due <= weekEnd) return "This week";

  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (due <= monthEnd) return "This month";

  const nextMonthEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  if (due <= nextMonthEnd) return "Next month";

  const thisYearEnd = new Date(today.getFullYear(), 11, 31);
  if (due <= thisYearEnd) return "Later this year";

  const nextYearEnd = new Date(today.getFullYear() + 1, 11, 31);
  if (due <= nextYearEnd) return "Next year";

  return "Further out";
}

// ── Bucket header styles ─────────────────────────────────────────────────────

const BUCKET_STYLES: Record<DateBucket, string> = {
  "Overdue":         "text-red-600 dark:text-red-400",
  "This week":       "text-blue-600 dark:text-blue-400",
  "This month":      "text-muted-foreground",
  "Next month":      "text-muted-foreground",
  "Later this year": "text-muted-foreground",
  "Next year":       "text-muted-foreground",
  "Further out":     "text-muted-foreground",
  "No due date":     "text-muted-foreground/60",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function MyTasksPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState<string>(String(user?.id ?? ""));
  const [searchQuery, setSearchQuery] = useState("");
  const [sprintFilter, setSprintFilter] = useState<SprintFilterValue>("current");

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });
  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
  });
  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });
  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/milestones"],
  });
  const { data: sprints = [] } = useQuery<Sprint[]>({
    queryKey: ["/api/sprints"],
  });
  const { data: sprintSettings } = useQuery<TrackerSettings>({
    queryKey: ["/api/sprint-settings"],
    refetchInterval: 30_000,
  });

  const changeStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function handleDrop(taskId: number, newStatus: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    changeStatusMutation.mutate({ id: taskId, status: newStatus });
  }

  // The numeric user ID we're filtering by
  const numericFilterId = parseInt(filterUserId);

  // Tasks for this view: assigned to the chosen person, not archived, matching search
  const searchLower = searchQuery.trim().toLowerCase();
  const viewTasks = tasks.filter(t => {
    if (t.isArchived) return false;
    if (isNaN(numericFilterId) || !t.assigneeIds.includes(numericFilterId)) return false;
    if (!taskMatchesSprint(t, sprintFilter, sprintSettings?.currentSprintId)) return false;
    if (searchLower && !t.title.toLowerCase().includes(searchLower)) return false;
    return true;
  });

  // "You" label helper
  const isMe = numericFilterId === user?.id;
  const filterUser = users.find(u => u.id === numericFilterId);
  const viewLabel = isMe ? "My Tasks" : `${filterUser?.displayName ?? "…"}'s Tasks`;

  // Tasks within a status column, sorted into date buckets
  function getColumnBuckets(status: string) {
    const col = viewTasks.filter(t => t.status === status);
    const groups: Array<{ bucket: DateBucket; tasks: Task[] }> = [];
    for (const bucket of BUCKET_ORDER) {
      const bt = col.filter(t => getDueDateBucket(t) === bucket);
      if (bt.length > 0) groups.push({ bucket, tasks: bt });
    }
    return groups;
  }

  return (
    <div className="h-screen flex bg-background" data-testid="my-tasks-page">
      <AppSidebar open={sidebarOpen} onToggle={setSidebarOpen} activePage="my-tasks" />

      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Header ── */}
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
            <UserCheck className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">{viewLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">{user?.displayName}</span>
            <button onClick={toggleTheme} className="p-2 rounded-lg hover:bg-muted transition-colors">
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            <Link href="/history">
              <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="Chat history">
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
            <Link href="/">
              <button className="p-2 rounded-lg hover:bg-muted transition-colors" title="AI Assistant">
                <Zap className="w-4 h-4" />
              </button>
            </Link>
            <button
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* ── Toolbar ── */}
        <div className="px-6 py-3 border-b flex items-center gap-3 shrink-0 flex-wrap">
          <span className="text-sm font-medium text-muted-foreground shrink-0">Filter by person</span>
          <Select value={filterUserId} onValueChange={setFilterUserId}>
            <SelectTrigger className="h-8 text-sm w-52" data-testid="select-person-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Current user always first, labelled "Me" */}
              {user && (
                <SelectItem value={String(user.id)}>
                  Me ({user.displayName})
                </SelectItem>
              )}
              {users
                .filter(u => u.id !== user?.id)
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>
                    {u.displayName}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <SprintFilterSelect
            value={sprintFilter}
            onValueChange={setSprintFilter}
            sprints={sprints}
            testId="select-sprint-filter"
          />

          {/* Search */}
          <SearchBar
            data-testid="input-task-search"
            value={searchQuery}
            onChange={setSearchQuery}
            suggestions={tasks
              .filter(t =>
                !t.isArchived &&
                !isNaN(numericFilterId) &&
                t.assigneeIds.includes(numericFilterId) &&
                taskMatchesSprint(t, sprintFilter, sprintSettings?.currentSprintId),
              )
              .map(t => t.title)}
            placeholder="Search tasks…"
            widthClass="w-56 ml-auto"
          />

          {!isLoading && (
            <span className="text-sm text-muted-foreground shrink-0">
              {viewTasks.length} task{viewTasks.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* ── Board + detail panel ── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Kanban board */}
          <div className="flex-1 overflow-auto p-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex gap-4 min-w-[600px] items-start h-full">
                {STATUSES.map(status => {
                  const Icon = status.icon;
                  const isOver = dragOverColumn === status.value;
                  const groups = getColumnBuckets(status.value);
                  const totalCount = groups.reduce((n, g) => n + g.tasks.length, 0);

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
                      {/* Column header */}
                      <div className="px-4 pt-4 pb-3 flex items-center gap-2 shrink-0">
                        <Icon className={`w-4 h-4 ${status.headerColor}`} />
                        <span className={`text-sm font-semibold ${status.headerColor}`}>{status.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground bg-white/60 dark:bg-black/20 rounded-full px-2 py-0.5 font-medium">
                          {totalCount}
                        </span>
                      </div>

                      {/* Grouped cards */}
                      <div className="flex flex-col px-3 pb-4 min-h-[120px] gap-0 overflow-y-auto">
                        {groups.length === 0 ? (
                          <div className={`border-2 border-dashed rounded-lg p-4 text-center text-xs text-muted-foreground/60 transition-colors ${
                            isOver ? "border-primary/40 bg-primary/5" : "border-transparent"
                          }`}>
                            {isMe ? "No tasks" : `No tasks for ${filterUser?.displayName ?? "this person"}`}
                          </div>
                        ) : (
                          groups.map(({ bucket, tasks: bucketTasks }) => (
                            <div key={bucket} className="mb-1">
                              {/* Bucket label */}
                              <div className={`text-[10px] font-semibold uppercase tracking-wide px-1 pt-3 pb-1 first:pt-0 ${BUCKET_STYLES[bucket]}`}>
                                {bucket}
                                <span className="ml-1.5 font-normal normal-case tracking-normal opacity-70">
                                  · {bucketTasks.length}
                                </span>
                              </div>
                              {/* Cards */}
                              <div className="flex flex-col gap-2">
                                {bucketTasks.map(task => (
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
                                ))}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Slide-in detail panel */}
          <div
            className={`shrink-0 transition-all duration-300 ease-in-out overflow-x-hidden ${
              editTask ? "w-full sm:w-[420px] lg:w-[480px]" : "w-0"
            }`}
          >
            {editTask && (
              <TaskDetailPanel
                task={editTask}
                onClose={() => setEditTask(null)}
                onExpand={() => setLocation(`/tasks/${editTask.id}?from=my-tasks`)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
