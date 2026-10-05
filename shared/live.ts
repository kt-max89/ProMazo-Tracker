import { z } from "zod";

export const liveDomains = ["tasks", "projects", "milestones", "sprints", "plans", "teams", "posts", "reflections", "users", "presence"] as const;
export type LiveDomain = typeof liveDomains[number];
export const changeSchema = z.object({ domain: z.enum(liveDomains) }).strict();
export type LiveChange = z.infer<typeof changeSchema>;
export const safePages = {
  tasks: "Task board", task: "Task details", projects: "Projects", project: "Project details",
  teams: "Team overview", team: "Team workspace", reflections: "Reflections",
  mine: "My tasks", private: "Private workspace",
} as const;
export const presenceInputSchema = z.object({
  tabId: z.string().uuid(),
  page: z.enum(["tasks", "task", "projects", "project", "teams", "team", "reflections", "mine", "private"]),
  active: z.boolean(),
}).strict();
export type OnlineUser = { id: number; displayName: string; state: "active" | "idle"; page: string };
export type LiveStatus = "live" | "reconnecting" | "fallback";
export const PRESENCE_LEASE_SECONDS = 45;
export const sharedQueryRoots: Record<LiveDomain, string[]> = {
  tasks: ["/api/tasks", "/api/projects", "/api/teams"],
  projects: ["/api/projects", "/api/milestones", "/api/tasks", "/api/teams"],
  milestones: ["/api/milestones", "/api/projects", "/api/tasks", "/api/teams"],
  sprints: ["/api/sprints", "/api/sprint-settings", "/api/tasks", "/api/projects", "/api/milestones", "/api/reflections", "/api/reflections/recent"],
  plans: ["/api/projects"],
  teams: ["/api/teams", "/api/users", "/api/auth/me", "/api/projects", "/api/tasks", "/api/milestones"],
  posts: ["/api/team-posts"],
  reflections: ["/api/reflections", "/api/reflections/recent"],
  users: ["/api/users", "/api/auth/me", "/api/teams", "/api/tasks"],
  presence: [],
};