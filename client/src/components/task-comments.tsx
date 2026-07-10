import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TaskComment } from "@shared/schema";

type AppUser = { id: number; displayName: string; email: string };

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TaskComments({ taskId }: { taskId: number }) {
  const { toast } = useToast();
  const [body, setBody] = useState("");

  const { data: comments = [], isLoading } = useQuery<TaskComment[]>({
    queryKey: ["/api/tasks", taskId, "comments"],
    queryFn: () =>
      apiRequest("GET", `/api/tasks/${taskId}/comments`).then((r) => r.json()),
  });

  const { data: users = [] } = useQuery<AppUser[]>({ queryKey: ["/api/users"] });
  const userMap = new Map(users.map((u) => [u.id, u.displayName]));

  const addMutation = useMutation({
    mutationFn: (text: string) =>
      apiRequest("POST", `/api/tasks/${taskId}/comments`, { body: text }).then((r) => r.json()),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["/api/tasks", taskId, "comments"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    addMutation.mutate(body.trim());
  }

  return (
    <div data-testid="task-comments-section">
      <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
        <MessageSquare className="w-4 h-4" />
        Comments
      </h3>

      <div className="space-y-3 mb-4" data-testid="list-task-comments">
        {isLoading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : comments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          comments.map((c) => (
            <div
              key={c.id}
              data-testid={`comment-${c.id}`}
              className="rounded-md border bg-muted/30 px-3 py-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">
                  {userMap.get(c.authorId) ?? `User #${c.authorId}`}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(c.createdAt)}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <Textarea
          data-testid="input-new-comment"
          placeholder="Add a comment..."
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <Button
          type="submit"
          size="sm"
          className="self-end"
          disabled={addMutation.isPending || !body.trim()}
          data-testid="button-submit-comment"
        >
          {addMutation.isPending ? (
            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5 mr-1.5" />
          )}
          Comment
        </Button>
      </form>
    </div>
  );
}
