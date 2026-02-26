import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Send, FileText, BookOpen, LogOut, Shield, Settings, Loader2 } from "lucide-react";
import { useLocation, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

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

export default function ChatPage() {
  const { user, logout } = useAuth();
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: documents } = useQuery<any[]>({
    queryKey: ["/api/documents"],
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || isStreaming) return;

    const userMessage = query.trim();
    setQuery("");
    setMessages(prev => [...prev, { role: "user", content: userMessage }]);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: userMessage }),
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
            // skip malformed SSE
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
    <div className="h-screen flex flex-col bg-background" data-testid="chat-page">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="font-semibold text-lg">Internal Notes Q&A</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2" data-testid="text-user-name">
            {user?.displayName}
          </span>
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

      {/* Messages */}
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
                      <p className="text-sm whitespace-pre-wrap leading-relaxed prose prose-sm max-w-none" data-testid={`text-assistant-message-${i}`}>
                        {msg.content || (isStreaming && i === messages.length - 1 ? (
                          <span className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking...
                          </span>
                        ) : null)}
                      </p>
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

      {/* Input */}
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
  );
}
