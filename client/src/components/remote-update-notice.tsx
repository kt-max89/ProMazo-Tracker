import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Compare saved edit baselines, never local keystrokes. Reload is always explicit.
export function useRemoteUpdate<T>(value: T, editing: boolean) {
  const fingerprint = JSON.stringify(value);
  const baseline = useRef(fingerprint);
  const wasEditing = useRef(false);
  const [, rerender] = useState(0);
  if (!editing || !wasEditing.current) baseline.current = fingerprint;
  wasEditing.current = editing;
  return {
    changed: editing && baseline.current !== fingerprint,
    accept: () => { baseline.current = fingerprint; rerender(n => n + 1); },
  };
}

export function RemoteUpdateNotice({ changed, reload }: { changed: boolean; reload: () => void }) {
  if (!changed) return null;
  return <div role="status" className="my-3 rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
    <p>Updated by someone else. Your draft is unchanged. Saving may overwrite their changes.</p>
    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
      if (window.confirm("Discard your draft and reload the latest saved version?")) reload();
    }}>Discard draft and reload</Button>
  </div>;
}