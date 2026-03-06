import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Send, FileText, BookOpen, LogOut, Shield, Settings, Loader2, Plus, MessageSquare, Trash2, Sun, Moon, PanelLeftClose, PanelLeft } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import ReactMarkdown from "react-markdown";

type Citation = {
  documentId: number;
  documentTitle: string;
  chunkId: number;
  chunkText: string;
  similarity: number;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
};

type ChatSession = {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export default function ChatPage() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: documents } = useQuery<any[]>({
    queryKey: ["/api/documents"],
  });

  const { data: sessions, isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat-sessions"],
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
            if (parsed.type === "citations") {
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

  return (
    <div className="h-screen flex bg-background" data-testid="chat-page">
      {sidebarOpen && (
        <aside className="w-64 border-r flex flex-col shrink-0 bg-card" data-testid="sidebar">
          <div className="p-3 border-b flex items-center justify-between">
            <button
              data-testid="button-new-chat"
              onClick={startNewChat}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity flex-1"
            >
              <Plus className="w-4 h-4" />
              New Chat
            </button>
            <button
              data-testid="button-close-sidebar"
              onClick={() => setSidebarOpen(false)}
              className="p-2 rounded-lg hover:bg-muted transition-colors ml-2"
              title="Close sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {sessionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : sessions?.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No conversations yet</p>
            ) : (
              sessions?.map(session => (
                <div
                  key={session.id}
                  data-testid={`session-item-${session.id}`}
                  onClick={() => loadSession(session.id)}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                    activeSessionId === session.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span className="flex-1 truncate">{session.title}</span>
                  <button
                    data-testid={`button-delete-session-${session.id}`}
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>
      )}

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
            <Shield className="w-5 h-5 text-primary" />
            <h1 className="font-semibold text-lg">Internal Notes Q&A</h1>
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
                <Shield className="w-12 h-12 mx-auto text-muted-foreground/30 mb-4" />
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
