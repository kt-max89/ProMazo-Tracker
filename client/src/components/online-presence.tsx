import { useEffect, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type OnlinePresenceUser = {
  id: number;
  displayName: string;
  state: "active" | "idle";
  page: string;
};

export type OnlinePresenceProps = {
  users: OnlinePresenceUser[];
  status: "live" | "reconnecting" | "fallback";
};

const AVATAR_COLORS = [
  "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900",
  "bg-amber-100 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
  "bg-emerald-100 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-900",
  "bg-sky-100 text-sky-900 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900",
  "bg-violet-100 text-violet-900 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900",
  "bg-orange-100 text-orange-900 ring-orange-200 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-900",
];

const STATUS_COPY = {
  live: { label: "Live", className: "bg-emerald-500" },
  reconnecting: { label: "Reconnecting", className: "bg-amber-500" },
  fallback: { label: "Fallback", className: "bg-muted-foreground/60" },
} as const;

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return (words.length === 1
    ? words[0].slice(0, 2)
    : `${words[0][0]}${words[words.length - 1][0]}`).toLocaleUpperCase();
}

function getAvatarColor(id: number) {
  const stableId = Number.isFinite(id) ? Math.abs(Math.trunc(id)) : 0;
  return AVATAR_COLORS[stableId % AVATAR_COLORS.length];
}

/**
 * Only show a local, path-like page label. This is presentation-only (never a
 * link), and intentionally omits query strings, fragments, and control chars.
 */
function safePageLabel(page: string) {
  const allowed = ["Task board", "Task details", "Projects", "Project details", "Team overview", "Team workspace", "Reflections", "My tasks", "Private workspace"];
  return allowed.includes(page) ? page : "Private workspace";
}

function Avatar({
  user,
  compact = false,
}: {
  user: OnlinePresenceUser;
  compact?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold ring-2 ring-background",
        compact ? "h-7 w-7 text-[10px]" : "h-8 w-8 text-[11px]",
        getAvatarColor(user.id),
      )}
    >
      {getInitials(user.displayName)}
      <span
        className={cn(
          "absolute bottom-0 right-0 rounded-full border-2 border-background",
          compact ? "h-2 w-2" : "h-2.5 w-2.5",
          user.state === "active" ? "bg-emerald-500" : "bg-amber-400",
        )}
      />
    </span>
  );
}

function PersonDetails({ user }: { user: OnlinePresenceUser }) {
  return (
    <>
      <span className="block truncate font-medium">{user.displayName || "Unknown teammate"}</span>
      <span className="mt-0.5 block text-muted-foreground">
        {user.state === "active" ? "Active now" : "Idle"}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, viewing </span>
        {safePageLabel(user.page)}
      </span>
    </>
  );
}

export function OnlinePresence({ users, status }: OnlinePresenceProps) {
  const [small, setSmall] = useState(() => window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setSmall(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.id - b.id),
    [users],
  );
  const visibleUsers = sortedUsers.slice(0, small ? 2 : 4);
  const overflowUsers = sortedUsers.slice(small ? 2 : 4);
  const connection = STATUS_COPY[status];

  return (
    <TooltipProvider delayDuration={250}>
      <div
        className="flex min-w-0 items-center gap-2"
        aria-label={`Teammate presence: ${sortedUsers.length} online, connection ${connection.label.toLowerCase()}`}
        data-testid="online-presence"
      >
        <span className="flex items-center -space-x-2">
          {visibleUsers.map(user => (
            <Tooltip key={user.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="rounded-full outline-none transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`${user.displayName || "Unknown teammate"}, ${user.state === "active" ? "active now" : "idle"}, viewing ${safePageLabel(user.page)}`}
                  data-testid={`online-user-${user.id}`}
                >
                  <Avatar user={user} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-56 text-xs leading-relaxed">
                <PersonDetails user={user} />
              </TooltipContent>
            </Tooltip>
          ))}
          {overflowUsers.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="relative inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-full bg-muted px-2 text-[11px] font-semibold text-muted-foreground ring-2 ring-background outline-none transition-colors hover:bg-muted/80 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label={`Show ${overflowUsers.length} more ${overflowUsers.length === 1 ? "teammate" : "teammates"}`}
                  data-testid="online-presence-overflow"
                >
                  +{overflowUsers.length}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                side="bottom"
                className="w-[min(18rem,calc(100vw-2rem))] p-2"
                aria-label="Other online teammates"
              >
                <div className="mb-1 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Also here <span className="tabular-nums">({overflowUsers.length})</span>
                </div>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {overflowUsers.map(user => (
                    <li
                      key={user.id}
                      className="flex min-w-0 items-center gap-2.5 rounded-md px-2 py-2"
                      data-testid={`online-user-list-${user.id}`}
                    >
                      <Avatar user={user} compact />
                      <span className="min-w-0 text-xs leading-4">
                        <PersonDetails user={user} />
                      </span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </span>

        <span
          className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
          data-testid="online-presence-status"
          title={`Presence connection: ${connection.label}`}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", connection.className)} />
          <span className="hidden sm:inline">{connection.label}</span>
          <span className="sr-only sm:hidden">{connection.label}</span>
        </span>
      </div>
    </TooltipProvider>
  );
}

export default OnlinePresence;