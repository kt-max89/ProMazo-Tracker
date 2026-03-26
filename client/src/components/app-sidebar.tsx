import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { Plus, Loader2, MessageSquare, Trash2, PanelLeftClose, LayoutList } from "lucide-react";

type ChatSession = {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

interface AppSidebarProps {
  open: boolean;
  onToggle: (open: boolean) => void;
  activePage: "chat" | "tasks";
  activeSessionId?: number | null;
  onSelectSession?: (id: number) => void;
  onDeleteSession?: (e: React.MouseEvent, id: number) => void;
  onNewChat?: () => void;
}

export function AppSidebar({
  open,
  onToggle,
  activePage,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewChat,
}: AppSidebarProps) {
  const [, navigate] = useLocation();

  const { data: sessions, isLoading: sessionsLoading } = useQuery<ChatSession[]>({
    queryKey: ["/api/chat-sessions"],
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat-sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat-sessions"] });
    },
  });

  if (!open) return null;

  function handleSessionClick(id: number) {
    if (activePage === "tasks") {
      navigate("/");
    } else {
      onSelectSession?.(id);
    }
  }

  function handleDeleteSession(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    if (onDeleteSession) {
      onDeleteSession(e, id);
    } else {
      deleteSessionMutation.mutate(id);
    }
  }

  function handleNewChat() {
    if (activePage === "tasks") {
      navigate("/");
    } else {
      onNewChat?.();
    }
  }

  return (
    <aside className="w-64 border-r flex flex-col shrink-0 bg-card" data-testid="sidebar">
      <div className="p-3 border-b flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Link href="/tasks" className="flex-1">
            <button
              data-testid="link-sidebar-tasks"
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                activePage === "tasks"
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted text-foreground"
              }`}
            >
              <LayoutList className="w-4 h-4" />
              See Tasks
            </button>
          </Link>
          <button
            data-testid="button-close-sidebar"
            onClick={() => onToggle(false)}
            className="p-2 rounded-lg hover:bg-muted transition-colors shrink-0"
            title="Close sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
        <button
          data-testid="button-new-chat"
          onClick={handleNewChat}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" />
          New Chat
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
              onClick={() => handleSessionClick(session.id)}
              className={`group flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                activePage === "chat" && activeSessionId === session.id
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
  );
}
