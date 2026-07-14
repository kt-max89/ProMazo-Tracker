import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import {
  Loader2, Sun, Moon, LogOut, Zap, Settings, BookOpen, PanelLeft, UserCheck
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import type { Task, Project, Milestone } from "@shared/schema";
import { AppSidebar } from "@/components/app-sidebar";
import { TaskCard, isTaskOverdue } from "@/components/task-card";
import { TaskDetailPanel } from "@/components/task-detail-panel";

type AppUser = { id: number; displayName: string; email: string };

export default function MyTasksPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [editTask, setEditTask] = useState<Task | null>(null);

  const { data: tasks = [], isLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: users = [] } = useQuery<AppUser[]>({
    queryKey: ["/api/users"],
  });

  const { data: milestones = [] } = useQuery<Milestone[]>({
    queryKey: ["/api/milestones"],
  });

  // Filter to current user's tasks (non-archived)
  const myTasks = tasks
    .filter(t => !t.isArchived && t.assigneeIds.includes(user?.id ?? -1))
    .sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    });

  const overdueCount = myTasks.filter(isTaskOverdue).length;

  function handleLogout() {
    logout();
    setLocation("/auth");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <AppSidebar
          open={sidebarOpen}
          onToggle={setSidebarOpen}
          activePage="my-tasks"
        />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <header className="border-b px-4 py-3 flex items-center gap-3 shrink-0">
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              className="h-8 w-8"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>
          )}
          <div className="flex items-center gap-2 flex-1">
            <UserCheck className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-semibold">My Tasks</h1>
            {!isLoading && (
              <span className="text-sm text-muted-foreground">
                {myTasks.length} task{myTasks.length !== 1 ? "s" : ""}
                {overdueCount > 0 && (
                  <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                    · {overdueCount} overdue
                  </span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
            <Link href="/history">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Chat history">
                <BookOpen className="w-4 h-4" />
              </Button>
            </Link>
            {user?.role === "admin" && (
              <Link href="/admin">
                <Button variant="ghost" size="icon" className="h-8 w-8" title="Admin">
                  <Settings className="w-4 h-4" />
                </Button>
              </Link>
            )}
            <Link href="/">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="AI Assistant">
                <Zap className="w-4 h-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleLogout} title="Sign out">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : myTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <UserCheck className="w-10 h-10 text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground text-sm">No tasks assigned to you</p>
              <p className="text-muted-foreground/60 text-xs mt-1">
                Tasks assigned to you will appear here, sorted by due date.
              </p>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-2">
              {myTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  users={users}
                  milestones={milestones}
                  onClick={() => setEditTask(task)}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      {editTask && (
        <TaskDetailPanel
          task={editTask}
          onClose={() => setEditTask(null)}
        />
      )}
    </div>
  );
}
