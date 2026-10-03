import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, FileText, Loader2, Pencil, Plus, Save, X } from "lucide-react";
import type { Project, ProjectSprintPlan, Sprint, TrackerSettings } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectMarkdown } from "@/components/project-markdown";
import { useToast } from "@/hooks/use-toast";

const planKey = (projectId: number) => ["/api/projects", projectId, "sprint-plans"] as const;
const SPRINT_PLAN_TEMPLATE = (number: number) => `## Sprint ${number}
### Sprint Overview
Write a brief paragraph about where we are and how things feel

### Sprint goals (tactical)
1. These should map to milestones. Not specific tasks.

### Sprint Adaptive goals
1. List them here

### Sprint tasks
1. Create a list of tasks, broken down as small as possible
2. Here, we can just describe them all
3. Copy this entire plan and give it to the chat to create the tasks in bulk

### Uncertainty
* What things could get in our way?
* What things are you worried about?
* What are other impacts to the team in this sprint?`;

export function ProjectSprintPlans({
  project,
  navigationGuardRef,
}: {
  project: Project;
  navigationGuardRef: MutableRefObject<() => boolean>;
}) {
  const { toast } = useToast();
  const [plansOpen, setPlansOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState("");
  const [editBaseline, setEditBaseline] = useState("");
  const [draftSprintId, setDraftSprintId] = useState<number | null>(null);
  const [newPlanSprintSelection, setNewPlanSprintSelection] = useState<number | null>(null);
  // null means follow the current sprint, except while a new draft is active.
  const [viewedPlanId, setViewedPlanId] = useState<number | null>(null);
  const [planError, setPlanError] = useState("");
  const [duplicatePlan, setDuplicatePlan] = useState<ProjectSprintPlan | null>(null);
  const dirtyRef = useRef(false);
  const protectedUrl = useRef(window.location.href);
  const previousCurrentSprintId = useRef<number | null | undefined>(undefined);

  const sprintsQuery = useQuery<Sprint[]>({ queryKey: ["/api/sprints"], staleTime: 0 });
  const settingsQuery = useQuery<TrackerSettings>({
    queryKey: ["/api/sprint-settings"],
    queryFn: () => apiRequest("GET", "/api/sprint-settings").then(response => response.json()),
    refetchInterval: 5000,
    staleTime: 0,
  });
  const plansQuery = useQuery<ProjectSprintPlan[]>({
    queryKey: planKey(project.id),
    queryFn: () => apiRequest("GET", `/api/projects/${project.id}/sprint-plans`).then(response => response.json()),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const sprints = sprintsQuery.data ?? [];
  const plans = plansQuery.data ?? [];
  const currentSprintId = settingsQuery.data?.currentSprintId ?? null;
  const currentSprint = sprints.find(sprint => sprint.id === currentSprintId);
  const currentPlan = currentSprintId == null ? undefined : plans.find(plan => plan.sprintId === currentSprintId);
  const draftIsNew = editingPlan && draftSprintId != null;
  const viewedPlan = draftIsNew
    ? undefined
    : viewedPlanId == null
      ? currentPlan
      : plans.find(plan => plan.id === viewedPlanId);
  const activeSprintId = draftIsNew
    ? draftSprintId
    : viewedPlan?.sprintId ?? (viewedPlanId == null ? currentSprintId : null);
  const activeSprint = sprints.find(sprint => sprint.id === activeSprintId);
  const isPlanDirty = editingPlan && planDraft !== editBaseline;
  dirtyRef.current = !!isPlanDirty;

  // A viewed historical plan is only a deliberate selection while settings
  // remain stable. Once the tracker current sprint changes, read mode follows
  // the new current plan; an in-progress editor keeps its assigned sprint.
  useEffect(() => {
    if (settingsQuery.data == null) return;
    const nextCurrentId = settingsQuery.data.currentSprintId ?? null;
    const previousId = previousCurrentSprintId.current;
    previousCurrentSprintId.current = nextCurrentId;
    if (previousId !== undefined && previousId !== nextCurrentId && !editingPlan) {
      setViewedPlanId(null);
      setDraftSprintId(null);
    }
    if (previousId !== undefined && previousId !== nextCurrentId) {
      // New tracker sprints/plans may have been created by another user.
      void sprintsQuery.refetch();
      void plansQuery.refetch();
    }
  }, [settingsQuery.data?.currentSprintId, editingPlan]);

  useEffect(() => {
    if (!editingPlan && viewedPlan) {
      setPlanDraft(viewedPlan.content);
      setEditBaseline(viewedPlan.content);
    } else if (!editingPlan && !viewedPlan && !draftIsNew) {
      setPlanDraft("");
      setEditBaseline("");
    }
  }, [viewedPlan?.id, viewedPlan?.content, editingPlan, draftIsNew]);

  function confirmDiscard(message = "You have an unsaved sprint plan. Leave without saving?") {
    if (!dirtyRef.current) return true;
    if (!window.confirm(message)) return false;
    dirtyRef.current = false;
    return true;
  }

  navigationGuardRef.current = () => confirmDiscard();

  useEffect(() => {
    if (!isPlanDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardInternalLink = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.origin !== window.location.origin) return;
      if (confirmDiscard()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // Capture runs before wouter's bubble-phase popstate handler, so canceling
    // back cannot unmount this component before the user's choice is handled.
    const guardBrowserBack = (event: PopStateEvent) => {
      if (confirmDiscard()) return;
      event.stopImmediatePropagation();
      window.history.pushState({ sprintPlanGuard: true }, "", protectedUrl.current);
    };
    protectedUrl.current = window.location.href;
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", guardInternalLink, true);
    window.addEventListener("popstate", guardBrowserBack, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", guardInternalLink, true);
      window.removeEventListener("popstate", guardBrowserBack, true);
    };
  }, [isPlanDirty]);

  const savePlan = useMutation({
    mutationFn: async ({ sprintId, content, planId }: { sprintId: number; content: string; planId?: number }) => {
      if (!planId) {
        const latestPlans = await apiRequest("GET", `/api/projects/${project.id}/sprint-plans`).then(response => response.json()) as ProjectSprintPlan[];
        queryClient.setQueryData(planKey(project.id), latestPlans);
        const existing = latestPlans.find(plan => plan.sprintId === sprintId);
        if (existing) {
          const error = new Error(`A plan already exists for Sprint ${existing.sprintNumber}.`);
          Object.assign(error, { existingPlan: existing });
          throw error;
        }
      }
      // Keep the structured 409 body, which apiRequest's Error conversion omits.
      const response = planId
        ? await apiRequest("PATCH", `/api/projects/${project.id}/sprint-plans/${planId}`, { content })
        : await fetch(`/api/projects/${project.id}/sprint-plans`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sprintId, content }),
        });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload?.message || `Request failed with status ${response.status}`);
        if (response.status === 409 && payload?.existingPlan) Object.assign(error, { existingPlan: payload.existingPlan });
        throw error;
      }
      return response.json() as Promise<ProjectSprintPlan>;
    },
    onSuccess: plan => {
      queryClient.setQueryData<ProjectSprintPlan[]>(planKey(project.id), previous => [
        ...(previous ?? []).filter(item => item.id !== plan.id),
        plan,
      ]);
      // Following current is the default; pin only a plan that is historical.
      setViewedPlanId(plan.sprintId === currentSprintId ? null : plan.id);
      setDraftSprintId(null);
      setPlanDraft(plan.content);
      setEditBaseline(plan.content);
      setEditingPlan(false);
      setPlanError("");
      setDuplicatePlan(null);
      toast({ title: "Sprint plan saved" });
    },
    onError: async (error: Error & { existingPlan?: ProjectSprintPlan }) => {
      setPlanError(error.message || "The sprint plan could not be saved. Your draft is still here.");
      if (error.existingPlan) {
        // The 409 response is authoritative and may have raced the preflight.
        queryClient.setQueryData<ProjectSprintPlan[]>(planKey(project.id), previous => [
          ...(previous ?? []).filter(plan => plan.id !== error.existingPlan!.id),
          error.existingPlan!,
        ]);
        setDuplicatePlan(error.existingPlan);
        return;
      }
      if (/already|exist|duplicate|409/i.test(error.message)) {
        await plansQuery.refetch();
        const duplicate = (queryClient.getQueryData<ProjectSprintPlan[]>(planKey(project.id)) ?? [])
          .find(plan => plan.sprintId === draftSprintId);
        if (duplicate) setDuplicatePlan(duplicate);
      }
    },
  });

  function startNewPlan(sprintId: number) {
    const sprint = sprints.find(item => item.id === sprintId);
    if (!sprint) return;
    const existing = plans.find(plan => plan.sprintId === sprintId);
    if (existing) {
      setViewedPlanId(existing.sprintId === currentSprintId ? null : existing.id);
      setDraftSprintId(null);
      setPlanDraft(existing.content);
      setEditBaseline(existing.content);
      setEditingPlan(false);
      setPlanError("");
      return;
    }
    setViewedPlanId(null);
    setDraftSprintId(sprintId);
    setPlanDraft(SPRINT_PLAN_TEMPLATE(sprint.number));
    setEditBaseline("");
    setEditingPlan(true);
    setPlanError("");
    setDuplicatePlan(null);
  }

  function beginEditingSavedPlan(plan: ProjectSprintPlan) {
    setViewedPlanId(plan.id);
    setDraftSprintId(null);
    setPlanDraft(plan.content);
    setEditBaseline(plan.content);
    setEditingPlan(true);
    setPlanError("");
  }

  function cancelPlanEdit() {
    const original = draftIsNew ? "" : viewedPlan?.content ?? "";
    setPlanDraft(original);
    setEditBaseline(original);
    setDraftSprintId(null);
    setEditingPlan(false);
    setPlanError("");
  }

  const sourceLoading = sprintsQuery.isLoading || settingsQuery.isLoading || plansQuery.isLoading;
  const sourceError = sprintsQuery.isError || settingsQuery.isError || plansQuery.isError;
  const configuredSprintInvalid = currentSprintId != null && !currentSprint && !sprintsQuery.isLoading && !sprintsQuery.isError;

  return (
    <section aria-labelledby="sprint-plan-title">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Planning</p>
          <h2 id="sprint-plan-title" className="mt-1 text-xl font-semibold">Current sprint plan</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {settingsQuery.isLoading || sprintsQuery.isLoading ? "Checking the tracker’s current sprint…" :
              settingsQuery.isError ? "Current sprint settings could not be refreshed; existing plan edits are still available." :
                configuredSprintInvalid ? `Tracker settings reference sprint ID ${currentSprintId}, but that sprint is unavailable.` :
                  currentSprint ? `Tracker current sprint · Sprint ${currentSprint.number}` : "No current sprint is set in tracker settings."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={savePlan.isPending} onClick={() => setPlansOpen(true)}><Clock3 className="mr-1.5 h-4 w-4"/>View all sprint plans</Button>
          {!editingPlan && <Button size="sm" onClick={() => {
            if (viewedPlan) beginEditingSavedPlan(viewedPlan);
            else if (currentSprintId != null) startNewPlan(currentSprintId);
          }} disabled={sourceLoading || sourceError || !sprints.length || (!viewedPlan && !currentSprint)}>
            {viewedPlan ? <Pencil className="mr-1.5 h-4 w-4"/> : <Plus className="mr-1.5 h-4 w-4"/>}{viewedPlan ? "Edit plan" : "Create sprint plan"}
          </Button>}
          {!editingPlan && viewedPlanId != null && viewedPlan?.sprintId !== currentSprintId && <Button variant="ghost" size="sm" onClick={() => {
            if (!confirmDiscard("You have unsaved changes to this sprint plan. Return to the current sprint?")) return;
            setViewedPlanId(null);
            setDraftSprintId(null);
          }}>Return to current plan</Button>}
        </div>
      </div>

      {/* Keep an active editor visible even if a polling/refetch request fails. */}
      {editingPlan ? (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
            <FileText className="h-4 w-4 shrink-0 text-primary"/>
            <span className="font-medium">{draftIsNew ? "New draft" : activeSprint ? `Sprint ${activeSprint.number}` : "Sprint plan"}</span>
            {activeSprintId != null && activeSprintId !== currentSprintId && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Historical · no longer current</span>}
            {activeSprintId === currentSprintId && currentSprint && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Current</span>}
          </div>
          {sourceError && <p role="status" className="mx-4 mt-3 text-xs text-amber-800 dark:text-amber-200">Some sprint information could not be refreshed. This editor remains assigned to Sprint {sprints.find(sprint => sprint.id === activeSprintId)?.number ?? activeSprintId}.</p>}
          {planError && <div role="alert" className="mx-4 mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p>{planError} Your draft is preserved; retry saving when ready.</p>
            {duplicatePlan && <Button size="sm" variant="outline" className="mt-2" onClick={() => {
              if (!confirmDiscard("You have an unsaved sprint plan. Discard it and open the saved duplicate?")) return;
              setViewedPlanId(duplicatePlan.sprintId === currentSprintId ? null : duplicatePlan.id);
              setDraftSprintId(null);
              setPlanDraft(duplicatePlan.content);
              setEditBaseline(duplicatePlan.content);
              setEditingPlan(false);
              setPlanError("");
              setDuplicatePlan(null);
            }}>Open saved Sprint {duplicatePlan.sprintNumber} plan</Button>}
          </div>}
          <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-2">
            <div className="min-w-0"><p className="mb-2 text-xs font-medium text-muted-foreground">Markdown</p><Textarea aria-label="Sprint plan Markdown" disabled={savePlan.isPending} value={planDraft} onChange={event => setPlanDraft(event.target.value)} rows={17} className="min-h-80 max-w-full font-mono text-sm leading-6"/>
              {draftIsNew && <p className="mt-2 text-xs text-muted-foreground">Unsaved draft · Sprint {sprints.find(sprint => sprint.id === draftSprintId)?.number ?? draftSprintId}. Nothing is saved until you choose Save plan.</p>}
            </div>
            <div className="min-w-0"><p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p><div className="min-h-80 overflow-hidden rounded-lg border bg-background p-4">{planDraft.trim() ? <ProjectMarkdown>{planDraft}</ProjectMarkdown> : <p className="text-sm text-muted-foreground">Your preview will appear here.</p>}</div></div>
            <div className="flex flex-wrap justify-end gap-2 lg:col-span-2">
              <Button variant="ghost" onClick={cancelPlanEdit} disabled={savePlan.isPending}><X className="mr-1.5 h-4 w-4"/>Cancel</Button>
              <Button onClick={() => {
                const sprintId = draftIsNew ? draftSprintId : viewedPlan?.sprintId;
                if (sprintId != null) savePlan.mutate({ sprintId, content: planDraft, planId: draftIsNew ? undefined : viewedPlan?.id });
              }} disabled={savePlan.isPending || (draftIsNew ? draftSprintId == null : viewedPlan == null)}>
                {savePlan.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin"/> : <Save className="mr-1.5 h-4 w-4"/>}Save plan
              </Button>
            </div>
          </div>
        </div>
      ) : sourceLoading ? (
        <div role="status" className="space-y-3 rounded-xl border bg-card p-5"><div className="h-4 w-32 animate-pulse rounded bg-muted"/><div className="h-24 animate-pulse rounded bg-muted"/></div>
      ) : sourceError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive">Sprint plan information couldn’t be loaded. <button className="underline" onClick={() => { settingsQuery.refetch(); sprintsQuery.refetch(); plansQuery.refetch(); }}>Try again</button></div>
      ) : configuredSprintInvalid && !viewedPlan ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm text-amber-900 dark:text-amber-100">Tracker settings point to sprint ID {currentSprintId}, which is not available. Choose a saved sprint plan to continue, or ask an administrator to correct the current sprint.</div>
      ) : !currentSprint && !viewedPlan ? (
        <div className="rounded-xl border border-dashed bg-card p-6 text-sm text-muted-foreground">There is no current sprint. Choose a sprint from View all sprint plans to create or open a historical plan.</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
            <FileText className="h-4 w-4 shrink-0 text-primary"/>
            <span className="font-medium">{activeSprint ? `Sprint ${activeSprint.number}` : "Sprint plan"}</span>
            {activeSprintId != null && activeSprintId !== currentSprintId && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">Historical · no longer current</span>}
            {activeSprintId === currentSprintId && currentSprint && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Current</span>}
          </div>
          {viewedPlan ? <div className="p-4 sm:p-6"><ProjectMarkdown>{viewedPlan.content}</ProjectMarkdown></div>
            : <div className="p-6 text-sm text-muted-foreground">No plan has been saved for Sprint {currentSprint?.number}. Create a draft when you’re ready; opening this project never creates one automatically.</div>}
        </div>
      )}

      <Dialog open={plansOpen} onOpenChange={setPlansOpen}>
        <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
          <DialogHeader><DialogTitle>All sprint plans</DialogTitle><DialogDescription>Saved plans for {project.name}, including historical sprints.</DialogDescription></DialogHeader>
          {sprintsQuery.isLoading ? <div className="space-y-2 py-2"><div className="h-12 animate-pulse rounded bg-muted"/><div className="h-12 animate-pulse rounded bg-muted"/></div>
            : sprintsQuery.isError ? <p className="text-sm text-destructive">Sprints couldn’t be loaded. <button className="underline" onClick={() => sprintsQuery.refetch()}>Retry</button></p>
              : plansQuery.isLoading ? <div role="status" className="h-16 animate-pulse rounded bg-muted"/>
                : plansQuery.isError ? <p className="text-sm text-destructive">Plans couldn’t be loaded. <button className="underline" onClick={() => plansQuery.refetch()}>Retry</button></p>
                  : <div className="space-y-3">
                    {plans.length ? <div className="divide-y rounded-lg border">{[...plans].sort((a, b) => b.sprintNumber - a.sprintNumber).map(plan => <button key={plan.id} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-muted/50" onClick={() => {
                      if (!confirmDiscard("You have an unsaved sprint plan. Discard it and open another plan?")) return;
                      setViewedPlanId(plan.sprintId === currentSprintId ? null : plan.id);
                      setDraftSprintId(null);
                      setPlanDraft(plan.content);
                      setEditBaseline(plan.content);
                      setEditingPlan(false);
                      setPlanError("");
                      setPlansOpen(false);
                    }}>
                      <span className="min-w-0"><span className="block font-medium">Sprint {plan.sprintNumber}{plan.sprintId === currentSprintId ? " · Current" : " · Historical"}</span><span className="block truncate text-xs text-muted-foreground">{plan.content.split("\n").find(line => line.trim()) || "Untitled plan"}</span></span><span className="shrink-0 text-xs text-primary">Open</span>
                    </button>)}</div> : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No saved plans for this project yet.</p>}
                    <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                      <p className="text-sm font-medium">Create a plan for a sprint</p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Select value={(newPlanSprintSelection ?? currentSprintId)?.toString() ?? ""} onValueChange={value => setNewPlanSprintSelection(Number(value))}>
                          <SelectTrigger aria-label="Choose sprint for new plan" className="min-w-0 flex-1"><SelectValue placeholder="Select a sprint"/></SelectTrigger>
                          <SelectContent>{sprints.map(sprint => <SelectItem key={sprint.id} value={sprint.id.toString()}>Sprint {sprint.number}{sprint.id === currentSprintId ? " · Current" : ""}</SelectItem>)}</SelectContent>
                        </Select>
                        <Button disabled={newPlanSprintSelection == null && currentSprintId == null} onClick={() => {
                          const sprintId = newPlanSprintSelection ?? currentSprintId;
                          if (sprintId != null && confirmDiscard("You have an unsaved sprint plan. Discard it and start another?")) {
                            startNewPlan(sprintId);
                            setPlansOpen(false);
                          }
                        }}><Plus className="mr-1.5 h-4 w-4"/>Create draft</Button>
                      </div>
                      {(newPlanSprintSelection ?? currentSprintId) != null && plans.some(plan => plan.sprintId === (newPlanSprintSelection ?? currentSprintId)) && <p className="text-xs text-amber-800 dark:text-amber-200">A plan already exists for this sprint. Create draft will open that saved plan instead; it will not overwrite it.</p>}
                    </div>
                  </div>}
        </DialogContent>
      </Dialog>
    </section>
  );
}