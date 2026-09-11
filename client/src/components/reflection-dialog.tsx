import { useEffect, useRef } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import {
  insertSprintReflectionSchema,
  type InsertSprintReflection,
  type Sprint,
  type TrackerSettings,
} from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const emptyWaste = () => ({ category: "wastefulness" as const, description: "" });

export function ReflectionDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const defaultSprintApplied = useRef(false);
  const { data: sprints = [] } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });
  const { data: settings } = useQuery<TrackerSettings>({ queryKey: ["/api/sprint-settings"] });

  const form = useForm<InsertSprintReflection>({
    resolver: zodResolver(insertSprintReflectionSchema),
    defaultValues: {
      sprintId: 0,
      summary: "",
      wastes: [emptyWaste(), emptyWaste()],
      kaizenWhat: "",
      kaizenWhy: "",
      kaizenDone: "",
      impact: "",
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "wastes" });

  useEffect(() => {
    if (open && settings?.currentSprintId && !defaultSprintApplied.current) {
      form.setValue("sprintId", settings.currentSprintId, { shouldDirty: false });
      defaultSprintApplied.current = true;
    }
  }, [open, settings?.currentSprintId, form]);

  const createMutation = useMutation({
    mutationFn: (values: InsertSprintReflection) =>
      apiRequest("POST", "/api/reflections", values).then(response => response.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/reflections/recent"] });
      toast({ title: "Reflection submitted" });
      form.reset({
        sprintId: settings?.currentSprintId ?? 0,
        summary: "",
        wastes: [emptyWaste(), emptyWaste()],
        kaizenWhat: "",
        kaizenWhy: "",
        kaizenDone: "",
        impact: "",
      });
      onClose();
    },
    onError: (error: any) =>
      toast({
        title: "Could not submit reflection",
        description: error.message,
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent
        className="max-h-[92vh] max-w-2xl overflow-y-auto"
        data-testid="dialog-reflection-form"
      >
        <DialogHeader>
          <DialogTitle>New sprint reflection</DialogTitle>
          <DialogDescription>
            Capture what happened, identify waste, and define one team improvement.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(values => createMutation.mutate(values))}
            className="space-y-6"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <FormItem>
                <FormLabel>Name</FormLabel>
                <Input value={user?.displayName ?? ""} disabled data-testid="input-reflection-name" />
              </FormItem>
              <FormField
                control={form.control}
                name="sprintId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sprint <span className="text-destructive">*</span></FormLabel>
                    <Select value={field.value ? String(field.value) : ""} onValueChange={value => field.onChange(Number(value))}>
                      <FormControl>
                        <SelectTrigger data-testid="select-reflection-sprint">
                          <SelectValue placeholder="Select a sprint" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sprints.map(sprint => (
                          <SelectItem key={sprint.id} value={String(sprint.id)}>
                            Sprint {sprint.number}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="summary"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sprint summary <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      placeholder="In 1–2 paragraphs, how did the sprint go and how did you feel?"
                      data-testid="input-reflection-summary"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <fieldset className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <legend className="text-sm font-medium">Waste identified <span className="text-destructive">*</span></legend>
                  <p className="text-xs text-muted-foreground mt-1">Add at least two observations.</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => append(emptyWaste())}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add waste
                </Button>
              </div>
              {fields.map((item, index) => (
                <div key={item.id} className="rounded-lg border bg-muted/20 p-3">
                  <div className="grid gap-3 sm:grid-cols-[170px_1fr_auto]">
                    <FormField
                      control={form.control}
                      name={`wastes.${index}.category`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Category</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="wastefulness">Wastefulness</SelectItem>
                              <SelectItem value="imbalance">Imbalance</SelectItem>
                              <SelectItem value="overload">Overload</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`wastes.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Describe the waste you observed" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="self-end"
                      disabled={fields.length <= 2}
                      onClick={() => remove(index)}
                      aria-label={`Remove waste ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {form.formState.errors.wastes?.root?.message && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.wastes.root.message}
                </p>
              )}
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border p-4">
              <div>
                <legend className="text-sm font-medium">Team improvement (Kaizen) <span className="text-destructive">*</span></legend>
                <p className="text-xs text-muted-foreground mt-1">Define one concrete improvement for the team.</p>
              </div>
              <FormField control={form.control} name="kaizenWhat" render={({ field }) => (
                <FormItem>
                  <FormLabel>What</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder="What should change?" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="kaizenWhy" render={({ field }) => (
                <FormItem>
                  <FormLabel>Why</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder="Why will this help?" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="kaizenDone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Definition of done</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder="How will the team know it is complete?" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </fieldset>

            <FormField
              control={form.control}
              name="impact"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Résumé bullet point / elevator pitch <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} placeholder="Summarize your impact from this sprint." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <a
              href="http://forms.gle/8PKviAsnyLcsAJdD6"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm font-medium text-primary hover:bg-primary/10"
              data-testid="link-happiness-index"
            >
              Complete the Happiness Index survey
              <ExternalLink className="h-4 w-4 shrink-0" />
            </a>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Submit reflection
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}