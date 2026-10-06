import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import {
  reflectionFieldLabels,
  type AppendReflection,
  type ReflectionAddition,
  type SprintReflection,
  type WasteCategory,
} from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORY_LABELS: Record<WasteCategory, string> = {
  wastefulness: "Wastefulness",
  imbalance: "Imbalance",
  overload: "Overload",
};
const DETAIL_KEY = (id: number) => ["/api/reflections/detail", id];
const OPTIONAL_FIELDS = [
  ["summary", "Sprint summary"],
  ["kaizenWhat", "Kaizen what"],
  ["kaizenWhy", "Kaizen why"],
  ["kaizenDone", "Definition of done"],
  ["impact", "Impact statement"],
] as const;
type WasteTarget = { key: string; label: string; wasteIndex?: number; wasteAdditionId?: number };
type NewWasteDraft = { category: WasteCategory; description: string };

export function ReflectionDetailDialog({
  reflection,
  onClose,
}: {
  reflection: SprintReflection | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const id = reflection?.id;
  const detailQuery = useQuery<SprintReflection>({
    queryKey: id ? DETAIL_KEY(id) : ["/api/reflections/detail", "closed"],
    enabled: id != null,
    queryFn: () => apiRequest("GET", `/api/reflections/${id}`).then(response => response.json()),
  });
  const detail = detailQuery.isError ? undefined : detailQuery.data ?? reflection;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newWastes, setNewWastes] = useState<NewWasteDraft[]>([]);
  const [draftReflectionId, setDraftReflectionId] = useState<number | undefined>(id);
  useEffect(() => {
    if (draftReflectionId !== id) {
      setDraft({});
      setNewWastes([]);
      setDraftReflectionId(id);
    }
  }, [id, draftReflectionId]);
  const canAdd = !!detail && user?.id === detail.authorId;

  const targets: WasteTarget[] = [];
  (detail?.wastes ?? []).forEach((waste, wasteIndex) => targets.push({
    key: `original-${wasteIndex}`,
    label: `Original waste ${wasteIndex + 1} · ${CATEGORY_LABELS[waste.category]}`,
    wasteIndex,
  }));
  (detail?.additions ?? []).filter(addition => addition.field === "newWaste").forEach(addition => targets.push({
    key: `addition-${addition.id}`,
    label: `Added waste · ${CATEGORY_LABELS[addition.category as WasteCategory]}`,
    wasteAdditionId: addition.id,
  }));

  const appendMutation = useMutation({
    mutationFn: (body: AppendReflection) =>
      apiRequest("POST", `/api/reflections/${id}/additions`, body).then(response => response.json()),
    onSuccess: () => {
      if (id != null) {
        void queryClient.invalidateQueries({ queryKey: DETAIL_KEY(id) });
        void queryClient.invalidateQueries({ queryKey: ["/api/reflections"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/reflections/recent"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/reflections/access"] });
      }
      setDraft({});
      setNewWastes([]);
      toast({ title: "Reflection addition saved" });
    },
    onError: (error: Error) => toast({
      title: "Could not save addition",
      description: error.message,
      variant: "destructive",
    }),
  });

  function submitAddition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const additions: AppendReflection["additions"] = [];
    OPTIONAL_FIELDS.forEach(([field]) => {
      const text = (draft[field] ?? "").trim();
      if (text) additions.push({ field, text });
    });
    targets.forEach(target => {
      const text = (draft[`waste:${target.key}`] ?? "").trim();
      if (text) additions.push({
        field: "wasteDescription",
        text,
        ...(target.wasteIndex != null ? { wasteIndex: target.wasteIndex } : { wasteAdditionId: target.wasteAdditionId }),
      });
    });
    newWastes.forEach(waste => {
      const text = waste.description.trim();
      if (text) additions.push({ field: "newWaste", text, category: waste.category });
    });
    if (!additions.length || id == null || appendMutation.isPending) return;
    appendMutation.mutate({ additions });
  }

  return (
    <Dialog open={reflection != null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="dialog-reflection-detail">
        {reflection && detail && (
          <>
            <DialogHeader>
              <DialogTitle>{detail.authorName}’s Sprint {detail.sprintNumber} reflection</DialogTitle>
              <DialogDescription>
                Submitted {new Date(detail.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 text-sm">
              <DetailSection title="Sprint summary" value={detail.summary} />
              <section>
                <h3 className="mb-2 font-semibold">Waste identified</h3>
                <div className="space-y-2">
                  {detail.wastes.map((waste, index) => (
                    <div key={`waste-${index}`} className="rounded-lg border p-3">
                      <span className="inline-flex rounded bg-muted px-2 py-0.5 text-xs font-medium">{CATEGORY_LABELS[waste.category]}</span>
                      <p className="mt-2 whitespace-pre-wrap break-words">{waste.description}</p>
                    </div>
                  ))}
                  {(detail.additions ?? []).filter(addition => addition.field === "newWaste").map(addition => (
                    <div key={`added-waste-${addition.id}`} className="rounded-lg border border-primary/20 bg-primary/[0.03] p-3">
                      <span className="inline-flex rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {CATEGORY_LABELS[addition.category as WasteCategory]}
                      </span>
                      <p className="mt-2 whitespace-pre-wrap break-words">{addition.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Added by {addition.authorName}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="mb-2 font-semibold">Team improvement (Kaizen)</h3>
                <div className="grid gap-3">
                  <DetailSection title="What" value={detail.kaizenWhat} compact />
                  <DetailSection title="Why" value={detail.kaizenWhy} compact />
                  <DetailSection title="Definition of done" value={detail.kaizenDone} compact />
                </div>
              </section>
              <DetailSection title="Résumé bullet point / elevator pitch" value={detail.impact} />
              <AdditionTrail additions={detail.additions ?? []} />
              {canAdd && (
                <form className="space-y-4 border-t pt-5" onSubmit={submitAddition} data-testid="form-reflection-addition">
                  <div>
                    <h3 className="font-semibold">Add to this reflection</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Add context without changing the original submission. Leave fields blank to skip them.</p>
                  </div>
                  {OPTIONAL_FIELDS.map(([field, label]) => (
                    <label key={field} className="block space-y-1.5">
                      <span className="text-sm font-medium">{label}</span>
                      <Textarea
                        aria-label={`Add ${label.toLowerCase()}`}
                        data-testid={`input-reflection-addition-${field}`}
                        rows={2}
                        value={draft[field] ?? ""}
                        onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))}
                      />
                    </label>
                  ))}
                  {targets.length > 0 && (
                    <fieldset className="space-y-3">
                      <legend className="text-sm font-medium">Add context to an existing waste</legend>
                      {targets.map(target => (
                        <label key={target.key} className="block space-y-1.5">
                          <span className="text-xs text-muted-foreground">{target.label}</span>
                          <Textarea
                            aria-label={`Add description to ${target.label}`}
                            data-testid={`input-reflection-addition-${target.key}`}
                            rows={2}
                            value={draft[`waste:${target.key}`] ?? ""}
                            onChange={event => setDraft(current => ({ ...current, [`waste:${target.key}`]: event.target.value }))}
                          />
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <fieldset className="space-y-3">
                    <legend className="text-sm font-medium">Add categorized waste</legend>
                    {newWastes.map((waste, index) => (
                      <div key={index} className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[170px_1fr]">
                        <Select
                          value={waste.category}
                          onValueChange={value => setNewWastes(current => current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, category: value as WasteCategory } : item))}
                        >
                          <SelectTrigger aria-label={`New waste ${index + 1} category`} data-testid={`select-addition-waste-category-${index}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input
                          aria-label={`New waste ${index + 1} description`}
                          data-testid={`input-addition-new-waste-${index}`}
                          placeholder="Describe another waste"
                          value={waste.description}
                          onChange={event => setNewWastes(current => current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, description: event.target.value } : item))}
                        />
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setNewWastes(current => [...current, { category: "wastefulness", description: "" }])}
                      data-testid="button-add-reflection-waste"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />Add waste
                    </Button>
                  </fieldset>
                  <div className="flex justify-end">
                    <Button type="submit" disabled={appendMutation.isPending || (!Object.values(draft).some(value => value.trim()) && !newWastes.some(item => item.description.trim()))} data-testid="button-submit-reflection-addition">
                      {appendMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Save addition
                    </Button>
                  </div>
                </form>
              )}
              {detailQuery.isError && <p className="text-sm text-destructive">Couldn’t refresh this reflection. The displayed copy may be out of date.</p>}
            </div>
          </>
        )}
        {reflection && !detail && detailQuery.isLoading && <div className="py-8 text-center text-sm text-muted-foreground">Loading reflection…</div>}
        {reflection && detailQuery.isError && !detail && (
          <div className="space-y-3 py-8 text-center">
            <p className="text-sm text-destructive">This reflection is locked or could not be loaded.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => detailQuery.refetch()}>Try again</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdditionTrail({ additions }: { additions: ReflectionAddition[] }) {
  return (
    <section aria-labelledby="reflection-addition-history-heading" data-testid="reflection-addition-history">
      <h3 id="reflection-addition-history-heading" className="font-semibold">Addition history</h3>
      {additions.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No additions yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {[...additions].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map(addition => (
            <li key={addition.id} className="rounded-lg border bg-muted/15 p-3" data-testid={`reflection-addition-${addition.id}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-medium">{addition.authorName} · {additionLabel(addition)}</span>
                <time className="text-xs text-muted-foreground" dateTime={addition.createdAt}>
                  {new Date(addition.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words leading-6 text-foreground/90">{addition.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function additionLabel(addition: ReflectionAddition): string {
  if (addition.field === "wasteDescription") return addition.wasteIndex != null
    ? `Original waste ${addition.wasteIndex + 1} · Description`
    : `Added waste #${addition.wasteAdditionId} · Description`;
  if (addition.field === "newWaste") return `${CATEGORY_LABELS[addition.category as WasteCategory]} · New waste`;
  return reflectionFieldLabels[addition.field];
}

function DetailSection({ title, value, compact = false }: { title: string; value: string; compact?: boolean }) {
  return (
    <section className={compact ? "rounded-lg border p-3" : ""}>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-foreground/90">{value}</p>
    </section>
  );
}
