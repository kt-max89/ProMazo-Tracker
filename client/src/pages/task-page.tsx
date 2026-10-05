import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import ReactMarkdown from "react-markdown";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  CalendarDays,
  Check,
  FileText,
  Loader2,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import type { Milestone, Project, Sprint, Task } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { MultiUserSelect } from "@/components/multi-user-select";
import { TaskComments } from "@/components/task-comments";
import { TaskActivity } from "@/components/task-activity";

type AppUser = { id: number; displayName: string; email: string; isActive: boolean };

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "needs_review", label: "Needs review" },
  { value: "done", label: "Done" },
] as const;
const SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;

const taskPageSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(["not_started", "in_progress", "needs_review", "done"]),
  isBlocked: z.boolean().optional(),
  blockedReason: z.string().optional(),
  size: z.enum(SIZES).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  assigneeIds: z.array(z.number()).optional(),
  projectId: z.number().nullable(),
  milestoneId: z.number().nullable().optional(),
  sprintId: z.number().nullable().optional(),
}).refine(
  data => !data.isBlocked || Boolean(data.blockedReason?.trim()),
  { message: "Blocked reason is required", path: ["blockedReason"] },
).refine(
  data => data.projectId == null || data.milestoneId != null,
  { message: "Milestone is required when a project is selected", path: ["milestoneId"] },
);

type TaskPageValues = z.infer<typeof taskPageSchema>;

const defaultValues: TaskPageValues = {
  title: "",
  description: "",
  status: "not_started",
  isBlocked: false,
  blockedReason: "",
  size: null,
  dueDate: null,
  assigneeIds: [],
  projectId: null,
  milestoneId: null,
  sprintId: null,
};

function valuesFromTask(task: Task): TaskPageValues {
  return {
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    isBlocked: task.isBlocked,
    blockedReason: task.blockedReason ?? "",
    size: task.size,
    dueDate: task.dueDate,
    assigneeIds: task.assigneeIds,
    projectId: task.projectId,
    milestoneId: task.milestoneId,
    sprintId: task.sprintId,
  };
}

function getReturnPath(): string {
  const source = new URLSearchParams(window.location.search).get("from");
  if (source && /^project:[1-9]\d*$/.test(source)) return `/projects/${source.slice("project:".length)}`;
  if (source === "projects") return "/projects";
  if (source === "my-tasks") return "/my-tasks";
  return "/tasks";
}

export default function TaskPage() {
  const [, params] = useRoute("/tasks/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const taskId = Number(params?.id);
  const [editingDescription, setEditingDescription] = useState(false);

  const {
    data: task,
    isLoading,
    error,
  } = useQuery<Task>({
    queryKey: ["/api/tasks", taskId],
    queryFn: () => apiRequest("GET", `/api/tasks/${taskId}`).then(r => r.json()),
    enabled: Number.isInteger(taskId) && taskId > 0,
  });
  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: sprints = [] } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });

  const form = useForm<TaskPageValues>({
    resolver: zodResolver(taskPageSchema),
    defaultValues,
  });
  const watchProjectId = form.watch("projectId");
  const watchIsBlocked = form.watch("isBlocked");
  const watchedDescription = form.watch("description") ?? "";

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/projects", watchProjectId, "milestones"],
    queryFn: () =>
      watchProjectId == null
        ? Promise.resolve([])
        : apiRequest("GET", `/api/projects/${watchProjectId}/milestones`).then(r => r.json()),
    enabled: watchProjectId != null,
  });

  useEffect(() => {
    if (task) form.reset(valuesFromTask(task));
  }, [task, form]);

  const updateMutation = useMutation({
    mutationFn: (values: TaskPageValues) =>
      apiRequest("PATCH", `/api/tasks/${taskId}`, values).then(r => r.json() as Promise<Task>),
    onSuccess: updated => {
      queryClient.setQueryData(["/api/tasks", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "activity"] });
      form.reset(valuesFromTask(updated));
      setEditingDescription(false);
      toast({ title: "Task updated" });
    },
    onError: (err: any) =>
      toast({ title: "Could not save task", description: err.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () =>
      apiRequest(
        "POST",
        task?.isArchived ? `/api/tasks/${taskId}/restore` : `/api/tasks/${taskId}/archive`,
      ).then(r => r.json() as Promise<Task>),
    onSuccess: updated => {
      queryClient.setQueryData(["/api/tasks", taskId], updated);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "activity"] });
      form.reset(valuesFromTask(updated));
      toast({ title: updated.isArchived ? "Task archived" : "Task restored" });
    },
    onError: (err: any) =>
      toast({ title: "Could not update task", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading task…
        </div>
      </div>
    );
  }

  if (!task || error || !Number.isInteger(taskId)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground/40" />
          <div>
            <h1 className="text-xl font-semibold">Task not found</h1>
            <p className="text-sm text-muted-foreground mt-1">
              This task may have been removed, or the link may be incorrect.
            </p>
          </div>
          <Button onClick={() => setLocation(getReturnPath())}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Return to tasks
          </Button>
        </div>
      </div>
    );
  }

  const sprint = sprints.find(item => item.id === form.watch("sprintId"));

  return (
    <div className="min-h-screen bg-muted/20" data-testid="task-page">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <button
            onClick={() => setLocation(getReturnPath())}
            className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            data-testid="button-close-task-page"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">Back to {getReturnPath().startsWith("/projects/") || getReturnPath() === "/projects" ? "Project" : getReturnPath() === "/my-tasks" ? "My Tasks" : "Tasks"}</span>
          </button>
          <div className="flex items-center gap-2">
            {task.isArchived && (
              <span className="text-xs rounded-full bg-muted px-2.5 py-1 text-muted-foreground">
                Archived
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : task.isArchived ? (
                <RotateCcw className="w-4 h-4 mr-1.5" />
              ) : (
                <Archive className="w-4 h-4 mr-1.5" />
              )}
              {task.isArchived ? "Restore" : "Archive"}
            </Button>
            <Button
              type="submit"
              form="task-page-form"
              size="sm"
              disabled={updateMutation.isPending || !form.formState.isDirty}
              data-testid="button-save-task-page"
            >
              {updateMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Form {...form}>
          <form id="task-page-form" onSubmit={form.handleSubmit(values => updateMutation.mutate(values))}>
            <div className="max-w-4xl">
              <p
                className="mb-2 text-sm font-semibold text-muted-foreground"
                data-testid="text-task-page-id"
              >
                Task #{task.id}
              </p>
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        aria-label="Task title"
                        className="h-auto border-0 bg-transparent px-0 py-1 text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight shadow-none focus-visible:ring-0 break-words"
                        data-testid="input-task-page-title"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sprintId"
                render={({ field }) => (
                  <FormItem className="mt-2">
                    <Select
                      value={field.value == null ? "backlog" : String(field.value)}
                      onValueChange={value => { if (value) field.onChange(value === "backlog" ? null : Number(value)); }}
                    >
                      <FormControl>
                        <SelectTrigger className="h-8 w-auto min-w-32 border-0 bg-transparent px-0 text-base font-medium text-fuchsia-700 shadow-none focus:ring-0 dark:text-fuchsia-300">
                          <SelectValue>{sprint ? `Sprint ${sprint.number}` : "Backlog"}</SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="backlog">Backlog</SelectItem>
                        {sprints.map(item => (
                          <SelectItem key={item.id} value={String(item.id)}>Sprint {item.number}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>

            <section className="mt-8 rounded-xl border bg-card p-4 sm:p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {STATUSES.map(status => (
                            <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="projectId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project</FormLabel>
                      <Select
                        value={field.value == null ? "none" : String(field.value)}
                        onValueChange={value => {
                          // Radix's native form control can emit an empty value
                          // while asynchronously loaded options are mounting.
                          if (!value) return;
                          field.onChange(value === "none" ? null : Number(value));
                          form.setValue("milestoneId", null, { shouldDirty: true });
                        }}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">No project</SelectItem>
                          {projects.map(project => (
                            <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="milestoneId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Milestone</FormLabel>
                      <Select
                        disabled={watchProjectId == null}
                        value={field.value == null ? "none" : String(field.value)}
                        onValueChange={value => { if (value) field.onChange(value === "none" ? null : Number(value)); }}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="No milestone" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none" disabled={watchProjectId != null}>No milestone</SelectItem>
                          {milestones.map(milestone => (
                            <SelectItem key={milestone.id} value={String(milestone.id)}>{milestone.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="assigneeIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assignees</FormLabel>
                      <FormControl>
                        <MultiUserSelect users={users} value={field.value ?? []} onChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="dueDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Due date</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <CalendarDays className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                          <Input
                            type="date"
                            className="pl-9"
                            value={field.value ?? ""}
                            onChange={event => field.onChange(event.target.value || null)}
                          />
                        </div>
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Size</FormLabel>
                      <Select
                        value={field.value ?? "none"}
                        onValueChange={value => field.onChange(value === "none" ? null : value)}
                      >
                        <FormControl><SelectTrigger><SelectValue placeholder="No size" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="none">No size</SelectItem>
                          {SIZES.map(size => <SelectItem key={size} value={size}>{size}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              <div className="mt-4 pt-4 border-t space-y-3">
                <FormField
                  control={form.control}
                  name="isBlocked"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className={`w-4 h-4 ${field.value ? "text-red-500" : "text-muted-foreground"}`} />
                        <FormLabel className="!mt-0">Blocked</FormLabel>
                      </div>
                      <FormControl>
                        <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {watchIsBlocked && (
                  <FormField
                    control={form.control}
                    name="blockedReason"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Blocked reason</FormLabel>
                        <FormControl><Input {...field} placeholder="What is blocking this task?" /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            </section>

            <section className="mt-8">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h2 className="text-lg font-semibold">Description</h2>
                {!editingDescription ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditingDescription(true)}>
                    <Pencil className="w-4 h-4 mr-1.5" />
                    Edit
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      form.setValue("description", task.description ?? "", { shouldDirty: false });
                      setEditingDescription(false);
                    }}
                  >
                    <X className="w-4 h-4 mr-1.5" />
                    Cancel editing
                  </Button>
                )}
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    {editingDescription ? (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2">Markdown</p>
                          <FormControl>
                            <Textarea
                              {...field}
                              rows={22}
                              className="min-h-[28rem] resize-y font-mono text-sm leading-6 break-all"
                              placeholder="Write the task description in Markdown…"
                              data-testid="input-task-page-description"
                            />
                          </FormControl>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground mb-2">Live preview</p>
                          <MarkdownDocument value={watchedDescription} emptyLabel="Your preview will appear here." />
                        </div>
                      </div>
                    ) : (
                      <div onDoubleClick={() => setEditingDescription(true)}>
                        <MarkdownDocument
                          value={field.value ?? ""}
                          emptyLabel="No description yet. Select Edit to add one."
                        />
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </section>
          </form>
        </Form>

        <section className="mt-10 pt-8 border-t max-w-4xl">
          <TaskComments taskId={task.id} />
        </section>
        <section className="mt-10 pt-8 border-t max-w-4xl">
          <TaskActivity taskId={task.id} />
        </section>
      </main>
    </div>
  );
}

function MarkdownDocument({ value, emptyLabel }: { value: string; emptyLabel: string }) {
  return (
    <article
      className="min-h-48 rounded-xl border bg-card px-5 py-5 sm:px-8 sm:py-7 overflow-hidden
        prose prose-slate dark:prose-invert max-w-none
        prose-headings:scroll-mt-20 prose-headings:break-words
        prose-p:leading-7 prose-p:break-words
        prose-li:break-words prose-a:break-all
        prose-pre:max-w-full prose-pre:overflow-x-auto
        prose-code:break-all prose-table:block prose-table:max-w-full prose-table:overflow-x-auto
        [overflow-wrap:anywhere]"
      data-testid="task-markdown-document"
    >
      {value.trim() ? (
        <ReactMarkdown>{value}</ReactMarkdown>
      ) : (
        <p className="not-prose text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </article>
  );
}