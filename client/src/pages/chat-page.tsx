import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { LivePresence } from "@/lib/live";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Send, FileText, BookOpen, LogOut, Zap, Settings, Loader2, Sun, Moon, PanelLeft, ListTodo, PlusCircle, X, ChevronLeft, ChevronRight, FolderKanban, Users } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import ReactMarkdown from "react-markdown";
import { AppSidebar } from "@/components/app-sidebar";
import type { Sprint, TrackerSettings } from "@shared/schema";
import { eligibleProposalUsers, legacyProposalAssignment, type AssignmentUser } from "@shared/proposalAssignments";
import { ProposalAssigneeSelect } from "@/components/proposal-assignee-select";

type Citation = {
  documentId: number;
  documentTitle: string;
  chunkId: number;
  chunkText: string;
  similarity: number;
};

type ToolUsed = "SEE_TASKS" | "READ_DOCS" | "SEE_PROJECTS" | "SEE_TEAM" | "READ_PROJECT_CONTEXT" | "TEAM_SPRINT_PLANS" | "NO_TOOL";

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  toolsUsed?: ToolUsed[];
};

type ChatSession = {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type ProposedTaskDraft = {
  title: string;
  description?: string;
  assignedToName?: string;
  assigneeIds?: number[];
  projectName?: string;
  milestoneName?: string;
  dueDate?: string;
  size?: string;
  sprintId?: number | null;
};

type ValidatedProposal = {
  proposalId: string;
  type: "create_task";
  tasks: ProposedTaskDraft[];
};

const TASK_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL"] as const;

const fieldClass =
  "w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50";

function ProposalModal({
  proposal,
  onNotYet,
  onCreateTasks,
  isCreating,
}: {
  proposal: ValidatedProposal;
  onNotYet: () => void;
  onCreateTasks: (tasks: ProposedTaskDraft[]) => void;
  isCreating: boolean;
}) {
  const [editedTasks, setEditedTasks] = useState<ProposedTaskDraft[]>(() =>
    proposal.tasks.map((t) => ({ ...t }))
  );
  const [currentIndex, setCurrentIndex] = useState(0);

  const { user } = useAuth();
  const directory = useQuery<AssignmentUser[]>({
    queryKey: ["/api/users"], refetchOnMount: "always", refetchInterval: 30_000,
  });
  const users = directory.data;
  // The directory snapshot includes the reviewer's fresh membership too.
  const reviewer = users?.find(member => member.id === user?.id);
  const eligible = eligibleProposalUsers(users ?? [], reviewer);
  const eligibleIds = new Set(eligible.map(member => member.id));
  const [assignmentWarnings, setAssignmentWarnings] = useState<Record<number, string>>({});
  const labels = useRef(new Map<number, string>());
  users?.forEach(member => labels.current.set(member.id, member.displayName));
  useEffect(() => {
    void directory.refetch();
  }, [user?.teamId]);
  useEffect(() => {
    if (!users || directory.isFetching || directory.isError) return;
    if (editedTasks.every(draft => draft.assigneeIds !== undefined)) return;
    const warnings: Record<number, string> = {};
    const resolutions = editedTasks.map((draft, index) => {
      const resolved = draft.assigneeIds === undefined
        ? legacyProposalAssignment(draft.assignedToName, users, reviewer)
        : { ids: draft.assigneeIds };
      if (resolved.warning) warnings[index] = resolved.warning;
      return resolved.ids;
    });
    setEditedTasks(previous => previous.map((draft, index) =>
      draft.assigneeIds === undefined ? { ...draft, assigneeIds: resolutions[index] } : draft));
    setAssignmentWarnings(previous => ({ ...previous, ...warnings }));
  }, [users, directory.isFetching, directory.isError, reviewer, editedTasks]);
  const { data: projects } = useQuery<any[]>({ queryKey: ["/api/projects"] });
  const { data: allMilestones } = useQuery<any[]>({ queryKey: ["/api/milestones"] });
  const { data: sprints = [] } = useQuery<Sprint[]>({ queryKey: ["/api/sprints"] });
  const { data: sprintSettings } = useQuery<TrackerSettings>({ queryKey: ["/api/sprint-settings"] });

  const task = editedTasks[currentIndex];
  const total = editedTasks.length;

  useEffect(() => {
    if (sprintSettings?.currentSprintId == null) return;
    setEditedTasks(prev => prev.map(task =>
      task.sprintId === undefined ? { ...task, sprintId: sprintSettings.currentSprintId } : task,
    ));
  }, [sprintSettings?.currentSprintId]);

  function updateCurrent(field: keyof ProposedTaskDraft, value: string | number | null) {
    setEditedTasks((prev) =>
      prev.map((t, i) => {
        if (i !== currentIndex) return t;
        const updated = { ...t, [field]: value === "" ? undefined : value };
        if (field === "projectName") updated.milestoneName = undefined;
        return updated;
      })
    );
  }

  const milestonesForProject = (() => {
    if (!allMilestones) return [];
    if (!task.projectName || !projects) return [];
    const proj = projects.find((p) => p.name === task.projectName);
    if (!proj) return [];
    return allMilestones.filter((m: any) => m.projectId === proj.id);
  })();

  const invalidTasks = editedTasks.flatMap((draft, index) =>
    draft.assigneeIds?.some(id => !eligibleIds.has(id)) ? [index + 1] : []);
  const canCreate = !directory.isFetching && !directory.isError && !!users &&
    invalidTasks.length === 0 && editedTasks.every(t => t.title.trim().length > 0 && t.assigneeIds !== undefined);

  function changeAssignees(ids: number[]) {
    setEditedTasks(previous => previous.map((draft, index) =>
      index === currentIndex ? { ...draft, assigneeIds: ids } : draft));
    setAssignmentWarnings(previous => ({ ...previous, [currentIndex]: "" }));
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      data-testid="proposal-modal"
    >
      <div className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-primary shrink-0" />
            <h2 className="font-semibold text-sm">
              {total === 1 ? "Proposed Task" : `Proposed Tasks`}
            </h2>
          </div>

          <div className="flex items-center gap-1">
            {total > 1 && (
              <>
                <span className="text-xs text-muted-foreground mr-1">
                  {currentIndex + 1} / {total}
                </span>
                <button
                  onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  disabled={currentIndex === 0 || isCreating}
                  className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30"
                  aria-label="Previous task"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setCurrentIndex((i) => Math.min(total - 1, i + 1))}
                  disabled={currentIndex === total - 1 || isCreating}
                  className="p-1 rounded hover:bg-muted transition-colors disabled:opacity-30"
                  aria-label="Next task"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              data-testid="button-close-proposal"
              onClick={onNotYet}
              disabled={isCreating}
              className="p-1 rounded hover:bg-muted transition-colors ml-1 disabled:opacity-50"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* ── Scrollable form body ── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5" data-testid={`proposal-row-${currentIndex}`}>

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Title <span className="text-destructive">*</span>
            </label>
            <input
              data-testid={`proposal-row-${currentIndex}-title`}
              className={fieldClass}
              value={task.title}
              onChange={(e) => updateCurrent("title", e.target.value)}
              disabled={isCreating}
              placeholder="Task title"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Description
            </label>
            <textarea
              data-testid={`proposal-row-${currentIndex}-description`}
              className={`${fieldClass} resize-none`}
              rows={6}
              value={task.description ?? ""}
              onChange={(e) => updateCurrent("description", e.target.value)}
              disabled={isCreating}
              placeholder="Add a description…"
            />
          </div>

          {/* Project + Milestone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Project</label>
              <select
                data-testid={`proposal-row-${currentIndex}-project`}
                className={fieldClass}
                value={task.projectName ?? ""}
                onChange={(e) => updateCurrent("projectName", e.target.value)}
                disabled={isCreating}
              >
                <option value="">— none —</option>
                {projects?.map((p: any) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Milestone</label>
              <select
                data-testid={`proposal-row-${currentIndex}-milestone`}
                className={fieldClass}
                value={task.milestoneName ?? ""}
                onChange={(e) => updateCurrent("milestoneName", e.target.value)}
                disabled={isCreating || milestonesForProject.length === 0}
              >
                <option value="">— none —</option>
                {milestonesForProject.map((m: any) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Assignment + planning fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assigned To</label>
              <ProposalAssigneeSelect
                users={directory.isError ? [] : eligible}
                selected={task.assigneeIds ?? []}
                labels={labels.current}
                onChange={changeAssignees}
                onOpen={() => { void directory.refetch(); }}
                disabled={isCreating}
                testId={`proposal-row-${currentIndex}-assignee`}
              />
              <div className="text-xs space-y-1" aria-live="polite">
                {directory.isFetching && <p>Loading current team members…</p>}
                {directory.isError && <p role="alert">Could not load team members. Your selections are preserved. <button type="button" className="underline" onClick={() => { void directory.refetch(); }}>Retry</button></p>}
                {users && !directory.isFetching && reviewer?.teamId == null && <p>You are not on a team. Join a team to assign people, or leave this task unassigned.</p>}
                {assignmentWarnings[currentIndex] && <p>{assignmentWarnings[currentIndex]}</p>}
                {(task.assigneeIds ?? []).some(id => !eligibleIds.has(id)) && !directory.isFetching && !directory.isError &&
                  <p role="alert">A selected person is no longer an active member of your team. Remove that selection or choose another team member.</p>}
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Due Date</label>
              <input
                type="date"
                data-testid={`proposal-row-${currentIndex}-duedate`}
                className={fieldClass}
                value={task.dueDate ?? ""}
                onChange={(e) => updateCurrent("dueDate", e.target.value)}
                disabled={isCreating}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sprint</label>
              <select
                data-testid={`proposal-row-${currentIndex}-sprint`}
                className={fieldClass}
                value={task.sprintId ?? "backlog"}
                onChange={(e) => updateCurrent(
                  "sprintId",
                  e.target.value === "backlog" ? null : Number(e.target.value),
                )}
                disabled={isCreating}
              >
                <option value="backlog">Backlog</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>Sprint {sprint.number}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Size</label>
              <select
                data-testid={`proposal-row-${currentIndex}-size`}
                className={fieldClass}
                value={task.size ?? ""}
                onChange={(e) => updateCurrent("size", e.target.value)}
                disabled={isCreating}
              >
                <option value="">— none —</option>
                {TASK_SIZES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        {invalidTasks.length > 0 && !directory.isFetching && !directory.isError &&
          <p role="alert" className="px-6 pb-2 text-xs text-destructive">Check assignments on task(s) {invalidTasks.join(", ")} before creating.</p>}
        <div className="flex items-center justify-between px-6 py-4 border-t shrink-0">
          {/* Dot indicators for multiple tasks */}
          {total > 1 ? (
            <div className="flex items-center gap-1.5">
              {editedTasks.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentIndex(i)}
                  disabled={isCreating}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === currentIndex ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                  aria-label={`Go to task ${i + 1}`}
                />
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Review and edit before creating.
            </span>
          )}

          <div className="flex items-center gap-3">
            <button
              data-testid="button-proposal-not-yet"
              onClick={onNotYet}
              disabled={isCreating}
              className="px-4 py-2 text-sm rounded-lg border hover:bg-muted transition-colors disabled:opacity-50"
            >
              Not Yet
            </button>
            <button
              data-testid="button-proposal-create"
              onClick={() => onCreateTasks(editedTasks)}
              disabled={isCreating || !canCreate}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
            >
              {isCreating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <PlusCircle className="w-3.5 h-3.5" />}
              {total === 1 ? "Create Task" : `Create ${total} Tasks`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  const [pendingProposal, setPendingProposal] = useState<ValidatedProposal | null>(null);
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    function resize() {
      // Reset first so deletion and programmatic clearing can shrink the draft.
      input!.style.height = "auto";
      // A wrapped placeholder is not draft content, even in a narrow layout.
      if (!input!.value) return;
      const style = getComputedStyle(input!);
      const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      input!.style.height = `${input!.scrollHeight + borders}px`;
    }

    resize();
    let width: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    observer.observe(input);
    // Also recompute when the viewport-height-based cap changes.
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [query]);

  const { data: documents } = useQuery<any[]>({
    queryKey: ["/api/documents"],
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat-sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat-sessions"] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadSession(sessionId: number) {
    try {
      const res = await fetch(`/api/chat-sessions/${sessionId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load session");
      const data = await res.json();
      setActiveSessionId(sessionId);
      setMessages(data.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        citations: [],
      })));
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  function startNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setQuery("");
    setPendingProposal(null);
  }

  async function handleDeleteSession(e: React.MouseEvent, sessionId: number) {
    e.stopPropagation();
    if (sessionId === activeSessionId) {
      startNewChat();
    }
    deleteSessionMutation.mutate(sessionId);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;

    const userMessage = query.trim();
    setQuery("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);

    let currentSessionId = activeSessionId;

    try {
      if (!currentSessionId) {
        const title = userMessage.slice(0, 60) + (userMessage.length > 60 ? "..." : "");
        const res = await apiRequest("POST", "/api/chat-sessions", { title });
        const session = await res.json();
        currentSessionId = session.id;
        setActiveSessionId(session.id);
        queryClient.invalidateQueries({ queryKey: ["/api/chat-sessions"] });
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: userMessage, sessionId: currentSessionId }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.message);
      }

      if (response.headers.get("content-type")?.includes("application/json")) {
        const data = await response.json();
        setMessages(prev => [...prev, { role: "assistant", content: data.answer, citations: [] }]);
        setIsStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      let assistantContent = "";
      let citations: Citation[] = [];

      setMessages(prev => [...prev, { role: "assistant", content: "", citations: [] }]);

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.type === "route") {
              const toolUsed = parsed.data as ToolUsed;
              setMessages(prev => {
                const updated = [...prev];
                const current = updated[updated.length - 1];
                const toolsUsed = current.toolsUsed ?? [];
                updated[updated.length - 1] = {
                  ...current,
                  toolsUsed: toolsUsed.includes(toolUsed) ? toolsUsed : [...toolsUsed, toolUsed],
                };
                return updated;
              });
            } else if (parsed.type === "citations") {
              citations = parsed.data;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], citations };
                return updated;
              });
            } else if (parsed.type === "token") {
              assistantContent += parsed.data;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: assistantContent };
                return updated;
              });
            } else if (parsed.type === "task_proposal") {
              setPendingProposal(parsed.data as ValidatedProposal);
            } else if (parsed.type === "error") {
              throw new Error(parsed.data);
            }
          } catch (parseErr) {
          }
        }
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to get answer",
        variant: "destructive",
      });
      setMessages(prev => {
        if (prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1]?.content) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  function handleNotYet() {
    setPendingProposal(null);
    setMessages(prev => [
      ...prev,
      {
        role: "assistant",
        content: "Okay, I didn't create them. What should be refined: the task names, descriptions, assignment, or which tasks to include?",
      },
    ]);
  }

  async function handleCreateTasks(editedTasks: ProposedTaskDraft[]) {
    if (!pendingProposal || isCreatingTasks) return;
    setIsCreatingTasks(true);
    try {
      const res = await apiRequest("POST", "/api/task-proposals/approve", {
        tasks: editedTasks,
      });
      const data = await res.json();
      setPendingProposal(null);
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `Created ${data.created} task${data.created === 1 ? "" : "s"}.`,
        },
      ]);
    } catch (err: any) {
      void queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: "Error creating tasks",
        description: err.message || "Failed to create tasks",
        variant: "destructive",
      });
    } finally {
      setIsCreatingTasks(false);
    }
  }

  return (
    <div className="h-screen flex bg-background" data-testid="chat-page">
      {pendingProposal && (
        <ProposalModal
          proposal={pendingProposal}
          onNotYet={handleNotYet}
          onCreateTasks={handleCreateTasks}
          isCreating={isCreatingTasks}
        />
      )}

      <AppSidebar
        open={sidebarOpen}
        onToggle={setSidebarOpen}
        activePage="chat"
        activeSessionId={activeSessionId}
        onSelectSession={loadSession}
        onDeleteSession={handleDeleteSession}
        onNewChat={startNewChat}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                data-testid="button-open-sidebar"
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-lg hover:bg-muted transition-colors"
                title="Open sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            <Zap className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">ProMazo Task Tracker</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-sm text-muted-foreground mr-2" data-testid="text-user-name">
              {user?.displayName}
            </span>
            <button
              data-testid="button-toggle-theme"
              onClick={toggleTheme}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            >
              {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </button>
            {user?.role === "admin" && (
              <Link href="/admin">
                <button data-testid="link-admin" className="p-2 rounded-lg hover:bg-muted transition-colors" title="Admin">
                  <Settings className="w-4 h-4" />
                </button>
              </Link>
            )}
            <Link href="/history">
              <button data-testid="link-history" className="p-2 rounded-lg hover:bg-muted transition-colors" title="Citation History">
                <BookOpen className="w-4 h-4" />
              </button>
            </Link>
            <button
              data-testid="button-logout"
              onClick={async () => { await logout(); setLocation("/auth"); }}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
          <LivePresence />
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-20">
                <Zap className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                <h2 className="text-xl font-medium mb-2" data-testid="text-welcome">Ask a question</h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Get help with tasks, projects, teammates, sprints, updates, reflections, and relevant documents.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-3"
                  : "space-y-3"}`}
                >
                  {msg.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap" data-testid={`text-user-message-${i}`}>{msg.content}</p>
                  ) : (
                    <>
                       {msg.toolsUsed?.some(tool => tool !== "NO_TOOL") && (
                        <div className="flex items-center gap-1.5 mb-1 ml-1" data-testid={`tool-indicator-${i}`}>
                           {msg.toolsUsed.filter(tool => tool !== "NO_TOOL").map(tool => (
                             <span key={tool} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground/70 text-[11px]">
                               {tool === "SEE_TASKS" && <ListTodo className="w-3 h-3" />}
                               {tool === "SEE_PROJECTS" && <FolderKanban className="w-3 h-3" />}
                               {(tool === "READ_PROJECT_CONTEXT" || tool === "TEAM_SPRINT_PLANS") && <BookOpen className="w-3 h-3" />}
                               {tool === "SEE_TEAM" && <Users className="w-3 h-3" />}
                               {tool === "READ_DOCS" && <FileText className="w-3 h-3" />}
                               {tool === "SEE_TASKS" && "Task Board"}
                               {tool === "SEE_PROJECTS" && "Projects"}
                               {tool === "READ_PROJECT_CONTEXT" && "Plans & overviews"}
                               {tool === "TEAM_SPRINT_PLANS" && "Team sprint plans"}
                               {tool === "SEE_TEAM" && "Team"}
                               {tool === "READ_DOCS" && "Documents"}
                             </span>
                           ))}
                        </div>
                      )}
                      <div className="bg-card border rounded-2xl rounded-bl-md px-4 py-3">
                        {msg.content ? (
                          <div className="text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert prose-headings:mt-3 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-foreground" data-testid={`text-assistant-message-${i}`}>
                            <ReactMarkdown>{msg.content}</ReactMarkdown>
                          </div>
                        ) : (isStreaming && i === messages.length - 1 ? (
                          <span className="flex items-center gap-2 text-muted-foreground text-sm">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking...
                          </span>
                        ) : null)}
                      </div>
                      {msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 ml-1">
                          {msg.citations.map((cit, ci) => (
                            <div
                              key={ci}
                              data-testid={`citation-${i}-${ci}`}
                              className="group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 text-xs text-muted-foreground hover:bg-muted cursor-default transition-colors"
                              title={cit.chunkText}
                            >
                              <FileText className="w-3 h-3" />
                              <span className="font-medium">[{ci + 1}]</span>
                              <span className="max-w-[150px] truncate">{cit.documentTitle}</span>
                              <span className="text-[10px] opacity-60">{Math.round(cit.similarity * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t px-4 py-4 shrink-0">
          <form onSubmit={handleSubmit} className="max-w-3xl mx-auto relative">
            <textarea
              data-testid="input-query"
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about tasks, projects, people, sprints, or documents..."
              rows={1}
              className="block w-full min-h-[46px] max-h-[max(46px,min(240px,30dvh))] overflow-y-auto resize-none rounded-xl border border-input bg-card px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isStreaming}
            />
            <button
              data-testid="button-send"
              type="submit"
              disabled={isStreaming || !query.trim()}
              className="absolute right-2 bottom-2 p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              {isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
          <p className="text-center text-[11px] text-muted-foreground mt-2">
            Answers may use live workspace data and relevant documents. Verify important decisions with your team.
          </p>
        </div>
      </div>
    </div>
  );
}
