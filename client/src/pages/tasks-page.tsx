import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Plus, Loader2, AlertCircle, CheckCircle2, Clock, Ban,
  Archive, RotateCcw, Pencil, Sun, Moon, LogOut, Zap,
  Settings, BookOpen, PanelLeft, UserCircle2
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import ReactMarkdown from "react-markdown";
import type { Task } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";

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
    value: "blocked",
    label: "Blocked",
    icon: Ban,
    badgeColor: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    columnBg: "bg-pink-50 dark:bg-pink-950/20",
    columnBorder: "border-pink-200 dark:border-pink-900",
    headerColor: "text-pink-700 dark:text-pink-400",
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

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "done"]),
  blockedReason: z.string().optional(),
  assignedTo: z.number().nullable().optional(),
}).refine(data => {
  if (data.status === "blocked" && !data.blockedReason?.trim()) return false;
  return true;
}, { message: "Blocked reason is required when status is blocked", path: ["blockedReason"] });

type TaskFormValues = z.infer<typeof taskFormSchema>;

function TaskFormDialog({
  open,
  onClose,
  task,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task;
}) {
  const { toast } = useToast();
  const isEdit = !!task;

  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
  });

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      description: task?.description ?? "",
      status: (task?.status as StatusValue) ?? "not_started",
      blockedReason: task?.blockedReason ?? "",
      assignedTo: task?.assignedTo ?? null,
    },
  });

  const watchStatus = form.watch("status");
  const [descEditing, setDescEditing] = useState(!task?.description);

  const createMutation = useMutation({
    mutationFn: (data: TaskFormValues) =>
      apiRequest("POST", "/api/tasks", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: TaskFormValues) =>
      apiRequest("PATCH", `/api/tasks/${task!.id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/tasks/${task!.id}/archive`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task archived" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(data: TaskFormValues) {
    if (isEdit) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-task-form">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "Edit the task details below." : "Fill in the details to create a new task."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input data-testid="input-task-title" placeholder="Task title" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-task-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {watchStatus === "blocked" && (
              <FormField
                control={form.control}
                name="blockedReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blocked reason</FormLabel>
                    <FormControl>
                      <Input data-testid="input-blocked-reason" placeholder="Why is this blocked?" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="assignedTo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Assigned to</FormLabel>
                  <Select
                    onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))}
                    value={field.value != null ? String(field.value) : "none"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-task-assignee">
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {users.map(u => (
                        <SelectItem key={u.id} value={String(u.id)}>{u.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    {descEditing ? (
                      <Textarea
                        data-testid="input-task-description"
                        placeholder="Optional description (supports markdown)"
                        rows={6}
                        autoFocus
                        onBlur={() => { if (field.value?.trim()) setDescEditing(false); }}
                        {...field}
                      />
                    ) : (
                      <div
                        data-testid="input-task-description"
                        onClick={() => setDescEditing(true)}
                        className="min-h-[9rem] cursor-text rounded-md border border-input bg-transparent px-3 py-2 text-sm prose prose-sm max-w-none dark:prose-invert prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-foreground"
                      >
                        <ReactMarkdown>{field.value || ""}</ReactMarkdown>
                      </div>
                    )}
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              {isEdit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="button-archive-task"
                  onClick={() => archiveMutation.mutate()}
                  disabled={archiveMutation.isPending}
                  className="text-muted-foreground"
                >
                  <Archive className="w-3.5 h-3.5 mr-1.5" />
                  Archive
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel-task">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-submit-task">
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

function TaskCard({
  task,
  users,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  task: Task;
  users: AppUser[];
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const meta = statusMeta(task.status);
  const Icon = meta.icon;
  const assignee = task.assignedTo != null ? users.find(u => u.id === task.assignedTo) : null;

  return (
    <div
      data-testid={`card-task-${task.id}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="bg-white dark:bg-card border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:shadow-md hover:border-primary/30 transition-all group select-none"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug flex-1" data-testid={`text-task-title-${task.id}`}>
          {task.title}
        </p>
        <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-60 shrink-0 mt-0.5" />
      </div>
      {task.status === "blocked" && task.blockedReason && (
        <div className="flex items-center gap-1 mt-2 text-xs text-pink-600 dark:text-pink-400">
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
      <div className="mt-2">
        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${meta.badgeColor}`}>
          <Icon className="w-3 h-3" />
          {meta.label}
        </span>
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

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: showArchived ? ["/api/tasks", "archived"] : ["/api/tasks"],
  });

  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
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
    if (newStatus === "blocked") {
      setEditTask({ ...task, status: "blocked" } as Task);
      return;
    }
    changeStatusMutation.mutate({ id: taskId, status: newStatus });
  }

  const byStatus = (status: string) => tasks.filter(t => t.status === status);

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

        <div className="px-6 py-3 border-b flex items-center gap-3 shrink-0">
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
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : showArchived ? (
            <div>
              {tasks.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground text-sm">No archived tasks</div>
              ) : (
                <div className="max-w-xl space-y-2">
                  {tasks.map(task => (
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
            <div className="flex gap-4 min-w-[680px] items-start h-full">
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
      </div>

      {createOpen && (
        <TaskFormDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      )}
      {editTask && (
        <TaskFormDialog open={!!editTask} onClose={() => setEditTask(null)} task={editTask} />
      )}
    </div>
  );
}
