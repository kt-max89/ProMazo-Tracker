import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./auth";
import { queryClient } from "./queryClient";
import { OnlinePresence } from "@/components/online-presence";
import { changeSchema, liveDomains, sharedQueryRoots, type LiveDomain, type LiveStatus, type OnlineUser } from "@shared/live";

const LiveContext = createContext<{ status: LiveStatus; users: OnlineUser[] }>({ status: "reconnecting", users: [] });
function pageDescriptor(path: string) {
  if (/^\/tasks\/\d+$/.test(path)) return "task";
  if (/^\/projects\/\d+$/.test(path)) return "project";
  if (/^\/teams\/\d+$/.test(path)) return "team";
  return ({ "/tasks": "tasks", "/projects": "projects", "/team-overview": "teams", "/reflections": "reflections", "/my-tasks": "mine" } as Record<string, string>)[path] ?? "private";
}

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [path] = useLocation();
  const pathRef = useRef(path); pathRef.current = path;
  const [status, setStatus] = useState<LiveStatus>("reconnecting");
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const heartbeatRef = useRef<() => void>(() => {});
  useEffect(() => { heartbeatRef.current(); }, [path]);

  useEffect(() => {
    if (!user) { setUsers([]); return; }
    let stopped = false;
    let source: EventSource | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
    let lastMessage = Date.now(), lastInput = Date.now(), lastBeat = 0;
    let failures = 0, currentStatus: LiveStatus = "reconnecting", beatPending = false;
    const tabId = crypto.randomUUID(); // unique per document, including duplicated tabs
    const domains = new Set<LiveDomain>();
    const updateStatus = (next: LiveStatus) => {
      currentStatus = next;
      if (!stopped) setStatus(next);
      if (next === "reconnecting") setUsers([]);
    };
    const invalidate = (domain?: LiveDomain) => {
      (domain ? [domain] : liveDomains).forEach(value => domains.add(value));
      if (invalidateTimer) return;
      invalidateTimer = setTimeout(() => {
        invalidateTimer = undefined;
        const roots = new Set(Array.from(domains).flatMap(value => sharedQueryRoots[value]));
        if (roots.has("/api/reflections") || roots.has("/api/reflections/recent")) {
          roots.add("/api/reflections/access");
          roots.add("/api/reflections/detail");
        }
        domains.clear();
        void queryClient.invalidateQueries({
          predicate: query => roots.has(String(query.queryKey[0])),
          refetchType: "active",
        });
      }, 250);
    };
    const revoked = () => {
      source?.close();
      stopped = true;
      setUsers([]);
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    };
    const heartbeat = async () => {
      if (stopped || beatPending || Date.now() - lastBeat < 2500) return;
      beatPending = true; lastBeat = Date.now();
      try {
        const response = await fetch("/api/live/presence", {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabId, page: pageDescriptor(pathRef.current), active: document.visibilityState === "visible" && Date.now() - lastInput < 60_000 }),
        });
        if (response.status === 401) revoked();
        else if (!response.ok && response.status !== 429) { updateStatus("fallback"); setUsers([]); }
      } catch { updateStatus("fallback"); setUsers([]); } finally { beatPending = false; }
    };
    heartbeatRef.current = () => { void heartbeat(); };
    const roster = async () => {
      try {
        const response = await fetch("/api/live/presence", { credentials: "include" });
        if (response.status === 401) return revoked();
        if (response.ok && !stopped && currentStatus !== "reconnecting") setUsers(await response.json());
      } catch { /* status/watchdog reports lost stream */ }
    };
    const connect = () => {
      if (stopped) return;
      lastMessage = Date.now();
      updateStatus("reconnecting");
      source = new EventSource("/api/live/events", { withCredentials: true });
      const heard = () => { lastMessage = Date.now(); };
      source.addEventListener("ready", event => {
        heard(); failures = 0;
        const mode = JSON.parse((event as MessageEvent).data).mode;
        updateStatus(mode === "live" ? "live" : "fallback");
        invalidate(); void heartbeat(); void roster();
      });
      source.addEventListener("heartbeat", event => {
        heard();
        const mode = JSON.parse((event as MessageEvent).data).mode;
        const next = mode === "live" ? "live" : "fallback";
        if (currentStatus !== next) { updateStatus(next); if (next === "live") { invalidate(); void roster(); } }
      });
      source.addEventListener("change", event => {
        heard();
        const parsed = changeSchema.safeParse(JSON.parse((event as MessageEvent).data));
        if (parsed.success) invalidate(parsed.data.domain);
      });
      source.addEventListener("presence", event => {
        heard();
        if (currentStatus !== "reconnecting") setUsers(JSON.parse((event as MessageEvent).data));
      });
      source.addEventListener("revoked", revoked);
      source.onerror = () => {
        source?.close();
        if (stopped) return;
        updateStatus(navigator.onLine ? "reconnecting" : "fallback");
        setUsers([]);
        failures++;
        reconnectTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) + Math.random() * 500);
      };
    };
    const activity = () => { lastInput = Date.now(); };
    const focus = () => {
      if (document.visibilityState !== "visible") return;
      lastInput = Date.now(); invalidate(); void heartbeat(); void roster();
    };
    const leave = () => {
      void fetch(`/api/live/presence/${tabId}`, { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {});
    };
    const beatTimer = setInterval(() => { void heartbeat(); }, 12_000);
    const safetyTimer = setInterval(() => {
      if (document.visibilityState === "visible") invalidate();
    }, 60_000);
    const fallbackTimer = setInterval(() => {
      if (Date.now() - lastMessage > 25_000) { updateStatus("fallback"); source?.close(); clearTimeout(reconnectTimer); connect(); }
      if (currentStatus !== "live" && document.visibilityState === "visible") { invalidate(); void roster(); }
    }, 10_000);
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    window.addEventListener("pagehide", leave);
    window.addEventListener("online", focus);
    window.addEventListener("offline", focus);
    connect(); void heartbeat();
    return () => {
      stopped = true; source?.close(); leave(); heartbeatRef.current = () => {};
      clearTimeout(reconnectTimer); clearTimeout(invalidateTimer);
      clearInterval(beatTimer); clearInterval(safetyTimer); clearInterval(fallbackTimer);
      document.removeEventListener("pointerdown", activity); document.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", focus); window.removeEventListener("focus", focus);
      window.removeEventListener("pagehide", leave); window.removeEventListener("online", focus); window.removeEventListener("offline", focus);
    };
  }, [user?.id]);
  return <LiveContext.Provider value={{ status, users }}>{children}</LiveContext.Provider>;
}

export function LivePresence() {
  const { status, users } = useContext(LiveContext);
  const { user } = useAuth();
  return user ? <div className="ml-auto shrink-0" data-testid="live-presence" data-live-status={status}><OnlinePresence users={users} status={status} /></div> : null;
}