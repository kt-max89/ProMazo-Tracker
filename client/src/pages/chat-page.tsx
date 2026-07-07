import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Send, FileText, BookOpen, LogOut, Zap, Settings, Loader2, Sun, Moon, PanelLeft, ListTodo, PlusCircle, X } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import ReactMarkdown from "react-markdown";
import { AppSidebar } from "@/components/app-sidebar";

type Citation = {
  documentId: number;
  documentTitle: string;
  chunkId: number;
  chunkText: string;
  similarity: number;
};

type ToolUsed = "SEE_TASKS" | "READ_DOCS" | "NO_TOOL";

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  toolUsed?: ToolUsed;
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
};

type ValidatedProposal = {
  proposalId: string;
  type: "create_task";
  tasks: ProposedTaskDraft[];
};

function ProposalModal({
  proposal,
  onNotYet,
  onCreateTasks,
  isCreating,
}: {
  proposal: ValidatedProposal;
  onNotYet: () => void;
  onCreateTasks: () => void;
  isCreating: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" data-testid="proposal-modal">
      <div className="bg-background border rounded-2xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Proposed Tasks</h2>
          </div>
          <button
            data-testid="button-close-proposal"
            onClick={onNotYet}
            className="p-1 rounded hover:bg-muted transition-colors"
            disabled={isCreating}
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-6 py-3">
          <p className="text-xs text-muted-foreground">
            These tasks will only be created if you approve them.
          </p>
        </div>

        <div className="px-6 pb-2 overflow-x-auto">
          <table className="w-full text-sm" data-testid="proposal-table">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground text-xs w-2/5">Task Name</th>
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground text-xs w-2/5">Description</th>
                <th className="text-left py-2 font-medium text-muted-foreground text-xs w-1/5">Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {proposal.tasks.map((task, i) => (
                <tr key={i} className="border-b last:border-0" data-testid={`proposal-row-${i}`}>
                  <td className="py-2.5 pr-4 font-medium align-top">{task.title}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground align-top">{task.description || <span className="text-muted-foreground/40">—</span>}</td>
                  <td className="py-2.5 text-muted-foreground align-top">{task.assignedToName || <span className="text-muted-foreground/40">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t">
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
            onClick={onCreateTasks}
            disabled={isCreating}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {isCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
            Create Tasks
          </button>
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingProposal, setPendingProposal] = useState<ValidatedProposal | null>(null);
  const [isCreatingTasks, setIsCreatingTasks] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
                updated[updated.length - 1] = { ...updated[updated.length - 1], toolUsed };
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

  async function handleCreateTasks() {
    if (!pendingProposal || isCreatingTasks) return;
    setIsCreatingTasks(true);
    try {
      const res = await apiRequest("POST", "/api/task-proposals/approve", {
        tasks: pendingProposal.tasks,
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

      <div className="flex-1 flex flex-col min-w-0">
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
            <span className="text-sm text-muted-foreground mr-2" data-testid="text-user-name">
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
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.length === 0 && (
              <div className="text-center py-20">
                <Zap className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
                <h2 className="text-xl font-medium mb-2" data-testid="text-welcome">Ask a question</h2>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">
                  Your questions will be answered using {documents?.length ?? 0} accessible documents.
                  Answers include source citations.
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
                      {(msg.toolUsed === "SEE_TASKS" || msg.toolUsed === "READ_DOCS") && (
                        <div className="flex items-center gap-1.5 mb-1 ml-1" data-testid={`tool-indicator-${i}`}>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground/70 text-[11px]">
                            {msg.toolUsed === "SEE_TASKS" ? (
                              <ListTodo className="w-3 h-3" />
                            ) : (
                              <FileText className="w-3 h-3" />
                            )}
                            {msg.toolUsed === "SEE_TASKS" ? "Task Board" : "Documents"}
                          </span>
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
              placeholder="Ask a question about your documents..."
              rows={1}
              className="w-full resize-none rounded-xl border border-input bg-card px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
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
            Answers are generated from your organization's documents. No data is used for model training.
          </p>
        </div>
      </div>
    </div>
  );
}
