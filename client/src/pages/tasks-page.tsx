import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Plus, Loader2, AlertCircle, CheckCircle2, Clock, Ban, AlertTriangle,
  RotateCcw, Pencil, Sun, Moon, LogOut, Zap,
  Settings, BookOpen, PanelLeft, UserCircle2, Flag
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import type { Task, Project, Milestone } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskFormDialog } from "@/components/task-form-dialog";
import { TaskDetailPanel } from "@/components/task-detail-panel";

type AppUser = { id: number; displayName: string; email: string };

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

type StatusValue = (typeof STATUSES)[number]["value"];

function statusMeta(value: string) {
  return STATUSES.find(s => s.value === value) ?? STATUSES[0];
}

function TaskCard({
  task,
  users,
  milestones,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  users: AppUser[];
  milestones: Milestone[];
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const assignee = task.assignedTo != null ? users.find(u => u.id === task.assignedTo) : null;
  const milestone = task.milestoneId != null ? milestones.find(m => m.id === task.milestoneId) : null;

  return (
    <div
      data-testid={`card-task-${task.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      data-blocked={task.isBlocked || undefined}
      className={`bg-white dark:bg-card border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:shadow-md transition-all group select-none ${
        task.isBlocked
          ? "border-2 border-red-500 dark:border-red-500 hover:border-red-500"
          : "hover:border-primary/30"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {task.isBlocked && (
          <AlertTriangle
            className="w-4 h-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5"
            data-testid={`icon-blocked-${task.id}`}
          />
        )}
        <p className="text-sm font-medium leading-snug flex-1" data-testid={`text-task-title-${task.id}`}>
          {task.title}
        </p>
        <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 shrink-0 mt-0.5" />
      </div>
      {milestone && (
        <div className="flex items-center gap-1 mt-2" data-testid={`badge-milestone-${task.id}`}>
          <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 font-medium max-w-full">
            <Flag className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{milestone.name}</span>
          </span>
        </div>
      )}
      {task.isBlocked && task.blockedReason && (
        <div className="flex items-center gap-1 mt-2 text-xs text-red-600 dark:text-red-500" data-testid={`text-blocked-reason-${task.id}`}>
          <Ban className="w-3 h-3 shrink-0" />
          <span className="truncate">{task.blockedReason}</span>
        </div>
      )}
      {assignee && (
        <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground" data-testid={`text-assignee-${task.id}`}>
          <UserCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{assignee.displayName}</span>
        </div>
      )}
    </div>
  );
}

function ArchivedTaskCard({ task, onRestore }: { task: Task; onRestore: () => void }) {
  const meta = statusMeta(task.status);
  const Icon = meta.icon;
  return (
    <div
      data-testid={`card-archived-task-${task.id}`}
      className="bg-card border rounded-lg p-3 opacity-70"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug flex-1 line-through text-muted-foreground">
          {task.title}
        </p>
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
      <div className="mt-2 flex items-center gap-1.5">
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>("all");

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: showArchived ? ["/api/tasks", "archived"] : ["/api/tasks"],
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
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/tasks/${id}`, { status }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleDrop(taskId: number, newStatus: string) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;
    changeStatusMutation.mutate({ id: taskId, status: newStatus });
  }

  const filteredTasks = projectFilter === "all"
    ? tasks
    : tasks.filter(t => t.projectId === parseInt(projectFilter));

  const byStatus = (status: string) => filteredTasks.filter(t => t.status === status);

  return (
    <div className="h-screen flex bg-background" data-testid="tasks-page">
      <AppSidebar
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        activePage="tasks"
      />

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
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">Task Tracker</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2" data-testid="text-tasks-user">{user?.displayName}</span>
            <button
              data-testid="button-toggle-theme-tasks"
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
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
                {projects.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Split container: board + detail panel side by side */}
        <div className="flex-1 flex overflow-hidden">
          {/* Board / archived area */}
          <div className="flex-1 overflow-auto p-6 transition-all duration-300">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
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
            className={`shrink-0 transition-all duration-300 ease-in-out overflow-hidden
              ${editTask ? "w-full sm:w-[420px] lg:w-[480px]" : "w-0"}`}
          >
            {editTask && (
              <TaskDetailPanel
                task={editTask}
                onClose={() => setEditTask(null)}
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
