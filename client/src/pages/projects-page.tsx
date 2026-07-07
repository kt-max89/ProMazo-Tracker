import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/lib/auth";
import {
  Plus, Loader2, Pencil, FolderOpen, Sun, Moon, LogOut,
  Zap, BookOpen, Settings, PanelLeft, CalendarDays, AlignLeft, ExternalLink
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form";
import type { Project, Task } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskFormDialog } from "@/components/task-form-dialog";

// ─── Project form ─────────────────────────────────────────────────────────────

const projectFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  timeline: z.string().optional(),
});
type ProjectFormValues = z.infer<typeof projectFormSchema>;

function ProjectFormDialog({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
}) {
  const { toast } = useToast();
  const isEdit = !!project;

  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectFormSchema),
    defaultValues: {
      name: project?.name ?? "",
      description: project?.description ?? "",
      timeline: project?.timeline ?? "",
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: ProjectFormValues) =>
      apiRequest("POST", "/api/projects", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project created" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: ProjectFormValues) =>
      apiRequest("PATCH", `/api/projects/${project!.id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Project updated" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function onSubmit(data: ProjectFormValues) {
    if (isEdit) updateMutation.mutate(data);
    else createMutation.mutate(data);
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription className="sr-only">
            {isEdit ? "Edit the project details." : "Fill in the details to create a new project."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Project name" {...field} />
                  </FormControl>
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
                    <Textarea placeholder="What is this project about?" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timeline"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timeline</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Q3 2026, 2 weeks, June–August" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending}>
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

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  tasks,
  onEdit,
  onAddTask,
  onEditTask,
}: {
  project: Project;
  tasks: Task[];
  onEdit: () => void;
  onAddTask: () => void;
  onEditTask: (task: Task) => void;
}) {
  const STATUS_COLORS: Record<string, string> = {
    not_started: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    in_progress: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    blocked: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  };
  const STATUS_LABELS: Record<string, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    blocked: "Blocked",
    done: "Done",
  };

  return (
    <div className="bg-card border rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="w-5 h-5 text-primary shrink-0" />
          <h2 className="font-semibold text-base truncate">{project.name}</h2>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
          title="Edit project"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* description */}
      {project.description && (
        <div className="flex gap-2 text-sm text-muted-foreground">
          <AlignLeft className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="leading-snug">{project.description}</p>
        </div>
      )}

      {/* timeline */}
      {project.timeline && (
        <div className="flex gap-2 text-sm text-muted-foreground">
          <CalendarDays className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{project.timeline}</span>
        </div>
      )}

      {/* tasks */}
      <div className="border-t pt-3 flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
          Tasks ({tasks.length})
        </p>
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No tasks yet</p>
        ) : (
          tasks.map(task => (
            <button
              key={task.id}
              onClick={() => onEditTask(task)}
              className="flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-lg hover:bg-muted transition-colors group"
            >
              <span className="text-sm truncate flex-1">{task.title}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[task.status] ?? ""}`}
              >
                {STATUS_LABELS[task.status] ?? task.status}
              </span>
              <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-60 shrink-0" />
            </button>
          ))
        )}
      </div>

      {/* add task */}
      <Button variant="outline" size="sm" className="w-full gap-2 mt-auto" onClick={onAddTask}>
        <Plus className="w-3.5 h-3.5" />
        Add task
      </Button>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskFormProjectId, setTaskFormProjectId] = useState<number | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery<Project[]>({
    queryKey: ["/api/projects"],
  });

  const { data: allTasks = [] } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  function openAddTask(projectId: number) {
    setTaskFormProjectId(projectId);
    setTaskFormOpen(true);
  }

  function closeTaskForm() {
    setTaskFormOpen(false);
    setTaskFormProjectId(null);
    setEditTask(null);
  }

  return (
    <div className="h-screen flex bg-background">
      <AppSidebar
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        activePage="projects"
      />

      <div className="flex-1 flex flex-col min-w-0">
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
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">Projects</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2">{user?.displayName}</span>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
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

        <div className="px-6 py-3 border-b flex items-center gap-3 shrink-0">
          <Button size="sm" className="gap-2" onClick={() => setProjectFormOpen(true)}>
            <Plus className="w-4 h-4" />
            New project
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {projectsLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-muted-foreground">
              <FolderOpen className="w-10 h-10 opacity-30" />
              <p className="text-sm">No projects yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  tasks={allTasks.filter(t => t.projectId === project.id && !t.isArchived)}
                  onEdit={() => setEditProject(project)}
                  onAddTask={() => openAddTask(project.id)}
                  onEditTask={task => setEditTask(task)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* project dialogs */}
      {projectFormOpen && (
        <ProjectFormDialog open onClose={() => setProjectFormOpen(false)} />
      )}
      {editProject && (
        <ProjectFormDialog open onClose={() => setEditProject(null)} project={editProject} />
      )}

      {/* task dialogs */}
      {taskFormOpen && (
        <TaskFormDialog
          open
          onClose={closeTaskForm}
          defaultProjectId={taskFormProjectId ?? undefined}
        />
      )}
      {editTask && (
        <TaskFormDialog open onClose={closeTaskForm} task={editTask} />
      )}
    </div>
  );
}
