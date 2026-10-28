import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/theme-provider";
import AuthPage from "@/pages/auth-page";
import ChatPage from "@/pages/chat-page";
import AdminPage from "@/pages/admin-page";
import HistoryPage from "@/pages/history-page";
import TasksPage from "@/pages/tasks-page";
import ProjectsPage from "@/pages/projects-page";
import TeamOverviewPage from "@/pages/team-overview-page";
import TeamPage from "@/pages/team-page";
import MyTasksPage from "@/pages/my-tasks-page";
import TaskPage from "@/pages/task-page";
import ProjectPage from "@/pages/project-page";
import ReflectionsPage from "@/pages/reflections-page";
import NotFound from "@/pages/not-found";
import { SessionCheck } from "@/components/session-check";
import { LiveProvider } from "@/lib/live";

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <AuthPage />;
  return <Component />;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user } = useAuth();
  if (!user) return <AuthPage />;
  if (user.role !== "admin") return <NotFound />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <ProtectedRoute component={ChatPage} />} />
      <Route path="/auth" component={AuthPage} />
      <Route path="/admin" component={() => <AdminRoute component={AdminPage} />} />
      <Route path="/history" component={() => <ProtectedRoute component={HistoryPage} />} />
      <Route path="/tasks" component={() => <ProtectedRoute component={TasksPage} />} />
      <Route path="/tasks/:id" component={() => <ProtectedRoute component={TaskPage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:id" component={() => <ProtectedRoute component={ProjectPage} />} />
      <Route path="/team-overview" component={() => <ProtectedRoute component={TeamOverviewPage} />} />
      <Route path="/teams/:id" component={() => <ProtectedRoute component={TeamPage} />} />
      <Route path="/reflections" component={() => <ProtectedRoute component={ReflectionsPage} />} />
      <Route path="/my-tasks" component={() => <ProtectedRoute component={MyTasksPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <LiveProvider>
          <TooltipProvider>
            <Toaster />
            <SessionCheck><Router /></SessionCheck>
          </TooltipProvider>
          </LiveProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
