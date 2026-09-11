import type { SprintReflection } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CATEGORY_LABELS = {
  wastefulness: "Wastefulness",
  imbalance: "Imbalance",
  overload: "Overload",
} as const;

export function ReflectionDetailDialog({
  reflection,
  onClose,
}: {
  reflection: SprintReflection | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={reflection != null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {reflection && (
          <>
            <DialogHeader>
              <DialogTitle>{reflection.authorName}’s Sprint {reflection.sprintNumber} reflection</DialogTitle>
              <DialogDescription>
                Submitted {new Date(reflection.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 text-sm">
              <DetailSection title="Sprint summary" value={reflection.summary} />
              <section>
                <h3 className="font-semibold mb-2">Waste identified</h3>
                <div className="space-y-2">
                  {reflection.wastes.map((waste, index) => (
                    <div key={index} className="rounded-lg border p-3">
                      <span className="inline-flex rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {CATEGORY_LABELS[waste.category]}
                      </span>
                      <p className="mt-2 whitespace-pre-wrap break-words">{waste.description}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="font-semibold mb-2">Team improvement (Kaizen)</h3>
                <div className="grid gap-3">
                  <DetailSection title="What" value={reflection.kaizenWhat} compact />
                  <DetailSection title="Why" value={reflection.kaizenWhy} compact />
                  <DetailSection title="Definition of done" value={reflection.kaizenDone} compact />
                </div>
              </section>
              <DetailSection title="Résumé bullet point / elevator pitch" value={reflection.impact} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  title,
  value,
  compact = false,
}: {
  title: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "rounded-lg border p-3" : ""}>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words leading-6 text-foreground/90">{value}</p>
    </section>
  );
}