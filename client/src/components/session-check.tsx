import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export function SessionCheck({ children }: { children: React.ReactNode }) {
  const { isLoading, sessionError, retrySession } = useAuth();
  if (isLoading) return (
    <div className="min-h-screen flex items-center justify-center" role="status" data-testid="session-loading">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Checking your session</span>
    </div>
  );
  if (sessionError) return (
    <div className="min-h-screen flex flex-col gap-4 items-center justify-center p-8" role="alert" data-testid="session-error">
      <p>We couldn’t check your session. Check your connection and try again.</p>
      <button onClick={retrySession} className="rounded-lg bg-primary text-primary-foreground px-4 py-2">Try again</button>
    </div>
  );
  return <>{children}</>;
}
