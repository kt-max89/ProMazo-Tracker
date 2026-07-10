import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Archive, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import ReactMarkdown from "react-markdown";
import type { Task, Project, Milestone } from "@shared/schema";

type AppUser = { id: number; displayName: string; email: string };

const STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
  { value: "needs_review", label: "Needs review" },
  { value: "done", label: "Done" },
] as const;
type StatusValue = (typeof STATUSES)[number]["value"];

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  status: z.enum(["not_started", "in_progress", "blocked", "needs_review", "done"]),
  blockedReason: z.string().optional(),
  assignedTo: z.number().nullable().optional(),
  projectId: z.number({ required_error: "Project is required" }).nullable(),
  milestoneId: z.number().nullable().optional(),
}).refine(data => {
  if (data.status === "blocked" && !data.blockedReason?.trim()) return false;
  return true;
}, { message: "Blocked reason is required when status is blocked", path: ["blockedReason"] })
  .refine(data => data.projectId != null, {
    message: "Project is required",
    path: ["projectId"],
  })
  .refine(data => {
    if (data.projectId != null && data.milestoneId == null) return false;
    return true;
  }, { message: "Milestone is required when a project is selected", path: ["milestoneId"] });

type TaskFormValues = z.infer<typeof taskFormSchema>;

export function TaskDetailPanel({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const { toast } = useToast();

  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const { data: projects = [] } = useQuery<Project[]>({ queryKey: ["/api/projects"] });

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task.title ?? "",
      description: task.description ?? "",
      status: (task.status as StatusValue) ?? "not_started",
      blockedReason: task.blockedReason ?? "",
      assignedTo: task.assignedTo ?? null,
      projectId: task.projectId ?? null,
      milestoneId: task.milestoneId ?? null,
    },
  });

  // Reset form when task changes
  useEffect(() => {
    form.reset({
      title: task.title ?? "",
      description: task.description ?? "",
      status: (task.status as StatusValue) ?? "not_started",
      blockedReason: task.blockedReason ?? "",
      assignedTo: task.assignedTo ?? null,
      projectId: task.projectId ?? null,
      milestoneId: task.milestoneId ?? null,
    });
    setDescEditing(!task.description);
  }, [task.id]);

  const watchStatus = form.watch("status");
  const watchProjectId = form.watch("projectId");
  const [descEditing, setDescEditing] = useState(!task.description);

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/projects", watchProjectId, "milestones"],
    queryFn: () =>
      watchProjectId != null
        ? apiRequest("GET", `/api/projects/${watchProjectId}/milestones`).then(r => r.json())
        : Promise.resolve([]),
    enabled: watchProjectId != null,
  });

  const prevProjectId = form.getValues("projectId");
  useEffect(() => {
    if (watchProjectId !== prevProjectId) {
      form.setValue("milestoneId", null);
    }
  }, [watchProjectId]);

  const updateMutation = useMutation({
    mutationFn: (data: TaskFormValues) =>
      apiRequest("PATCH", `/api/tasks/${task.id}`, data).then(r => r.json()),
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
      apiRequest("POST", `/api/tasks/${task.id}/archive`).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task archived" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function onSubmit(data: TaskFormValues) {
    updateMutation.mutate(data);
  }

  return (
    <div
      data-testid="task-detail-panel"
      className="flex flex-col h-full border-l bg-background"
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
        <h2 className="font-semibold text-base">Edit task</h2>
        <button
          data-testid="button-close-task-panel"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable form body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <Form {...form}>
          <form id="task-panel-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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

            {/* Project selector */}
            <FormField
              control={form.control}
              name="projectId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project <span className="text-destructive">*</span></FormLabel>
                  <Select
                    onValueChange={v => {
                      field.onChange(v === "none" ? null : parseInt(v));
                      form.setValue("milestoneId", null);
                    }}
                    value={field.value != null ? String(field.value) : "none"}
                  >
                    <FormControl>
                      <SelectTrigger data-testid="select-task-project">
                        <SelectValue placeholder="Select a project" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none" disabled>Select a project</SelectItem>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Milestone selector */}
            {watchProjectId != null && (
              <FormField
                control={form.control}
                name="milestoneId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Milestone <span className="text-destructive">*</span></FormLabel>
                    <Select
                      onValueChange={v => field.onChange(v === "none" ? null : parseInt(v))}
                      value={field.value != null ? String(field.value) : "none"}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-task-milestone">
                          <SelectValue placeholder="Select a milestone" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none" disabled>Select a milestone</SelectItem>
                        {milestones.length === 0 ? (
                          <SelectItem value="__empty__" disabled>No milestones — add one to the project first</SelectItem>
                        ) : (
                          milestones.map(m => (
                            <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
                        rows={8}
                        autoFocus={false}
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
          </form>
        </Form>
      </div>

      {/* Footer actions */}
      <div className="shrink-0 border-t px-5 py-3 flex items-center gap-2 justify-between">
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
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose} data-testid="button-cancel-task">
            Cancel
          </Button>
          <Button
            type="submit"
            form="task-panel-form"
            disabled={updateMutation.isPending}
            data-testid="button-submit-task"
          >
            {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
