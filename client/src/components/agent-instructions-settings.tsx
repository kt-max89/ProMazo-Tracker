import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Bot, Check, Clock3, FileText, Loader2, RefreshCw, RotateCcw, Save, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type AgentInstructions = {
  instructions: string;
  version: number;
  updatedAt: string | null;
  applicationRules: {
    creation: string;
    editing: string;
  };
};

const instructionsKey = ["/api/admin/agent-instructions"];
const MAX_CHARACTERS = 16000;

function isVersionConflict(error: unknown) {
  const err = error as { status?: number; message?: string } | undefined;
  return err?.status === 409 || /409|version|conflict|changed/i.test(err?.message ?? "");
}

function formatSavedAt(value: string | null) {
  if (!value) return "Not saved yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function AgentInstructionsSettings() {
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [savedText, setSavedText] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const initializedRef = useRef(false);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AgentInstructions>({
    queryKey: instructionsKey,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: { instructions: string; version: number }) => {
      const response = await apiRequest("PATCH", "/api/admin/agent-instructions", payload);
      return (await response.json()) as AgentInstructions;
    },
    onSuccess: (result, submitted) => {
      setSavedText(result.instructions);
      setSavedAt(result.updatedAt);
      setVersion(result.version);
      setConflict(false);
      setSaveSucceeded(true);
      setDraft((currentDraft) => currentDraft === submitted.instructions ? result.instructions : currentDraft);
      queryClient.setQueryData(instructionsKey, result);
      toast({ title: "Assistant instructions saved" });
    },
    onError: (saveError) => {
      setSaveSucceeded(false);
      if (isVersionConflict(saveError)) {
        setConflict(true);
        return;
      }
      toast({
        title: "Could not save instructions",
        description: saveError instanceof Error ? saveError.message : "Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (data && !initializedRef.current) {
      initializedRef.current = true;
      setDraft(data.instructions);
      setSavedText(data.instructions);
      setSavedAt(data.updatedAt);
      setVersion(data.version);
      setInitialized(true);
    }
  }, [data]);

  const isDirty = initialized && draft !== savedText;
  const isBlank = draft.trim().length === 0;
  const isTooLong = draft.length > MAX_CHARACTERS;
  const canSave = isDirty && !isBlank && !isTooLong && !conflict && !saveMutation.isPending;

  function discardLocalChanges() {
    if (!isDirty) return;
    if (!window.confirm("Discard your unsaved instruction edits and restore the last saved version?")) return;
    setDraft(savedText);
    setSaveSucceeded(false);
  }

  async function reloadLatest() {
    if (isDirty && !window.confirm("Reload the latest saved instructions? Your unsaved edits will be discarded.")) return;
    const latest = await refetch();
    if (latest.isError) {
      toast({ title: "Could not reload instructions", description: "Your draft is unchanged. Please try again.", variant: "destructive" });
      return;
    }
    if (latest.data) {
      setDraft(latest.data.instructions);
      setSavedText(latest.data.instructions);
      setSavedAt(latest.data.updatedAt);
      setVersion(latest.data.version);
      setConflict(false);
      setSaveSucceeded(false);
      setInitialized(true);
      toast({ title: "Latest instructions loaded" });
    }
  }

  function save() {
    if (!canSave) return;
    setSaveSucceeded(false);
    saveMutation.mutate({ instructions: draft, version });
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-card" aria-labelledby="agent-instructions-title">
      <div className="flex flex-col gap-3 border-b bg-muted/20 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <h2 id="agent-instructions-title" className="font-semibold">Assistant instructions</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              Set the guidance the project assistant uses to support national-team work and teammates.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Last saved: {formatSavedAt(savedAt)}</span>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex gap-3 rounded-md border border-primary/20 bg-primary/[0.04] p-3.5 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">
            Saved instructions apply to subsequent chat replies, including in existing chats. Internal response formats,
            permissions, and task approval rules remain enforced.
          </p>
        </div>

        <div>
          <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <label htmlFor="agent-instructions-editor" className="text-sm font-medium">Main chatbot instructions</label>
            <span className={`font-mono text-xs ${isTooLong ? "text-destructive" : "text-muted-foreground"}`} aria-live="polite">
              {draft.length.toLocaleString()} / {MAX_CHARACTERS.toLocaleString()} characters
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2" role="status" aria-label="Loading assistant instructions">
              <div className="h-10 animate-pulse rounded-md bg-muted/60" />
              <div className="h-40 animate-pulse rounded-md bg-muted/60" />
              <span className="sr-only">Loading saved instructions</span>
            </div>
          ) : isError && !initialized ? (
            <div className="rounded-md border border-destructive/25 bg-destructive/[0.04] p-4" role="alert">
              <div className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-medium">Could not load assistant instructions</p>
                  <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    disabled={isFetching}
                    className="mt-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                    Retry
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <textarea
                id="agent-instructions-editor"
                data-testid="input-agent-instructions"
                aria-describedby="agent-instructions-help agent-instructions-status"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSaveSucceeded(false);
                }}
                maxLength={MAX_CHARACTERS + 1}
                spellCheck
                rows={14}
                className="min-h-[18rem] w-full resize-y rounded-md border border-input bg-background px-3.5 py-3 font-mono text-[13px] leading-6 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p id="agent-instructions-help" className="mt-2 text-xs text-muted-foreground">
                Keep the operational guidance here. Saved whitespace is preserved exactly.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            id="agent-instructions-status"
            data-testid="agent-instructions-status"
            className="flex min-h-5 items-center gap-2 text-sm"
            role="status"
            aria-live="polite"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" /><span className="text-muted-foreground">Saving instructions…</span></>
            ) : conflict ? (
              <><AlertCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" /><span className="text-amber-800 dark:text-amber-300">Another admin saved a newer version. Your draft is unchanged.</span></>
            ) : saveSucceeded && !isDirty ? (
              <><Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" /><span className="text-emerald-800 dark:text-emerald-300">Saved successfully.</span></>
            ) : isDirty ? (
              <><span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" /><span className="text-muted-foreground">Unsaved changes</span></>
            ) : initialized ? (
              <><Check className="h-4 w-4 text-muted-foreground" aria-hidden="true" /><span className="text-muted-foreground">All changes saved</span></>
            ) : null}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              data-testid="button-reload-agent-instructions"
              onClick={reloadLatest}
              disabled={isLoading || isFetching || saveMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
              Reload latest
            </button>
            <button
              type="button"
              data-testid="button-discard-agent-instructions"
              onClick={discardLocalChanges}
              disabled={!isDirty || saveMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-3.5 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Discard edits
            </button>
            <button
              type="button"
              data-testid="button-save-agent-instructions"
              onClick={save}
              disabled={!canSave}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saveMutation.isPending ? "Saving…" : "Save instructions"}
            </button>
          </div>
        </div>

        {(isBlank || isTooLong) && isDirty && (
          <p className="text-sm text-destructive" role="alert">
            {isBlank ? "Instructions cannot be blank." : `Instructions must be ${MAX_CHARACTERS.toLocaleString()} characters or fewer.`}
          </p>
        )}

        {conflict && (
          <div className="flex flex-col gap-3 rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Reload the latest saved text to resolve this version conflict. You will be asked before local edits are discarded.</p>
            <button
              type="button"
              onClick={reloadLatest}
              disabled={isFetching}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Reload latest version
            </button>
          </div>
        )}

        {data && (
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <RulePanel title="Task creation contract" content={data.applicationRules.creation} />
            <RulePanel title="Task editing contract" content={data.applicationRules.editing} />
          </div>
        )}
      </div>
    </section>
  );
}

function RulePanel({ title, content }: { title: string; content: string }) {
  return (
    <section className="rounded-md border bg-muted/20 p-4" aria-label={title}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        {title}
      </h3>
      <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground/80">{content}</pre>
      <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">Read-only · enforced independently from editable guidance</p>
    </section>
  );
}
