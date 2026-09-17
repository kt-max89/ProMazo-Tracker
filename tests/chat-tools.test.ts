import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../server/db";
import { buildPrompt } from "../server/promptBuilder";
import { settleReadToolCalls } from "../server/readToolExecution";
import { runSeeTeamTool } from "../server/seeTeamTool";
import { queryTasks } from "../server/taskService";
import {
  buildRouterMessages,
  normalizeToolCalls,
  type ToolCall,
} from "../server/toolIntentSelector";
import {
  milestonesTable,
  projectsTable,
  reflectionsTable,
  sprintsTable,
  taskAssigneesTable,
  tasksTable,
  teamPostsTable,
  usersTable,
} from "../server/schema";
import { eq } from "drizzle-orm";
import type { IStorage } from "../server/storage";
import type { User } from "../shared/schema";

test("router keeps bounded recent history for follow-up questions", () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `turn-${index}`,
  }));
  const messages = buildRouterMessages("What about Angela?", history);

  assert.equal(messages[0].role, "system");
  assert.equal(messages.at(-1)?.role, "user");
  assert.equal(messages.at(-1)?.content, "What about Angela?");
  assert.equal(messages.length, 10);
  assert.equal(messages[1].content, "turn-4");
});

test("router validates, de-duplicates, and caps compatible read tools", () => {
  const calls = normalizeToolCalls([
    {
      name: "see_tasks",
      arguments: JSON.stringify({
        status: "in_progress",
        isBlocked: true,
        person: "Angela",
        project: "National Team",
        milestone: "Launch",
        sprintNumber: 72,
        currentSprint: true,
        query: "handoff",
        limit: 100,
      }),
    },
    { name: "see_projects", arguments: JSON.stringify({ query: "National", limit: 50 }) },
    { name: "read_docs", arguments: JSON.stringify({ query: "decision log" }) },
    { name: "see_team", arguments: JSON.stringify({ include: ["people", "updates"] }) },
    { name: "see_tasks", arguments: "{}" },
  ], "fallback query");

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(call => call.intent), ["SEE_TASKS", "SEE_PROJECTS", "READ_DOCS"]);
  assert.deepEqual(calls[0], {
    intent: "SEE_TASKS",
    args: {
      status: "in_progress",
      isBlocked: true,
      person: "Angela",
      project: "National Team",
      milestone: "Launch",
      sprintNumber: 72,
      currentSprint: true,
      query: "handoff",
      mode: "matching_tasks",
      limit: 20,
    },
  });
  assert.equal(calls[1].args.limit, 10);
});

test("one failed read tool does not discard successful tool results", async () => {
  const calls: ToolCall[] = [
    { intent: "SEE_TASKS", args: {} },
    { intent: "SEE_PROJECTS", args: {} },
  ];
  const results = await settleReadToolCalls(calls, async call => {
    if (call.intent === "SEE_TASKS") throw new Error("task source unavailable");
    return "project context";
  });

  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  if (results[1].status === "fulfilled") {
    assert.equal(results[1].value, "project context");
  }
});

test("final prompt labels multiple source types and partial failures", () => {
  const prompt = buildPrompt({
    message: "Compare the launch project with the written decision.",
    toolResults: [
      { type: "projects", content: "Launch: in progress", isEmpty: false },
      { type: "docs", content: "", isEmpty: true, error: "document lookup timed out" },
    ],
  });
  const finalMessage = prompt.at(-1);
  assert.equal(finalMessage?.role, "user");
  assert.match(String(finalMessage?.content), /PROJECTS AND MILESTONES \(live data\)/);
  assert.match(String(finalMessage?.content), /DOCUMENT CONTEXT \(retrieved evidence\)/);
  assert.match(String(finalMessage?.content), /Source unavailable: document lookup timed out/);
});

test("task query intersects text, status, blocked, project, milestone, sprint, and assignee", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [user] = await db.insert(usersTable).values({
    email: `chat-filter-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "user",
    displayName: `Angela ${suffix}`,
  }).returning();
  const [project] = await db.insert(projectsTable).values({ name: `Project ${suffix}` }).returning();
  const [milestone] = await db.insert(milestonesTable).values({
    projectId: project.id,
    name: `Milestone ${suffix}`,
  }).returning();
  const [sprint] = await db.insert(sprintsTable).values({ number: 900000 + Math.floor(Math.random() * 90000) }).returning();
  const insertedTasks = await db.insert(tasksTable).values([
    {
      title: `Matching handoff ${suffix}`,
      status: "in_progress",
      isBlocked: true,
      blockedReason: "Waiting",
      projectId: project.id,
      milestoneId: milestone.id,
      sprintId: sprint.id,
    },
    {
      title: `Nonmatching handoff ${suffix}`,
      status: "done",
      isBlocked: true,
      blockedReason: "Waiting",
      projectId: project.id,
      milestoneId: milestone.id,
      sprintId: sprint.id,
    },
  ]).returning();
  await db.insert(taskAssigneesTable).values(
    insertedTasks.map(task => ({ taskId: task.id, userId: user.id })),
  );

  try {
    const matches = await queryTasks({
      query: `Matching handoff ${suffix}`,
      status: "in_progress",
      isBlocked: true,
      projectIds: [project.id],
      milestoneIds: [milestone.id],
      sprintIds: [sprint.id],
      assigneeIds: [user.id],
    });
    assert.deepEqual(matches.map(task => task.id), [insertedTasks[0].id]);
  } finally {
    await db.delete(taskAssigneesTable).where(eq(taskAssigneesTable.userId, user.id));
    await db.delete(tasksTable).where(eq(tasksTable.projectId, project.id));
    await db.delete(milestonesTable).where(eq(milestonesTable.id, milestone.id));
    await db.delete(projectsTable).where(eq(projectsTable.id, project.id));
    await db.delete(sprintsTable).where(eq(sprintsTable.id, sprint.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
});

test("team reader returns authenticated roster, updates, and filtered reflections", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const [user] = await db.insert(usersTable).values({
    email: `chat-team-${suffix}@example.test`,
    passwordHash: "test-only",
    role: "user",
    displayName: `Teammate ${suffix}`,
  }).returning();
  const [sprint] = await db.insert(sprintsTable).values({ number: 800000 + Math.floor(Math.random() * 90000) }).returning();
  await db.insert(teamPostsTable).values({ authorId: user.id, body: `Launch update ${suffix}` });
  await db.insert(reflectionsTable).values({
    authorId: user.id,
    authorName: user.displayName,
    sprintId: sprint.id,
    summary: `Reflection ${suffix}`,
    wastes: [{ category: "wastefulness", description: "Duplicate work" }],
    kaizenWhat: "Share decisions",
    kaizenWhy: "Reduce rework",
    kaizenDone: "Decision log published",
    impact: "Faster delivery",
  });

  const authenticatedUser: User = {
    id: user.id,
    email: user.email,
    passwordHash: user.passwordHash,
    role: "user",
    displayName: user.displayName,
  };
  const storage = {
    getAllUsers: async () => [authenticatedUser],
  } as IStorage;

  try {
    const result = await runSeeTeamTool({
      include: ["people", "updates", "reflections"],
      person: user.displayName,
      sprintNumber: sprint.number,
      limit: 5,
    }, storage);
    assert.equal(result.isEmpty, false);
    assert.match(result.content, new RegExp(user.displayName));
    assert.match(result.content, new RegExp(`Launch update ${suffix}`));
    assert.match(result.content, new RegExp(`Reflection ${suffix}`));
  } finally {
    await db.delete(reflectionsTable).where(eq(reflectionsTable.authorId, user.id));
    await db.delete(teamPostsTable).where(eq(teamPostsTable.authorId, user.id));
    await db.delete(sprintsTable).where(eq(sprintsTable.id, sprint.id));
    await db.delete(usersTable).where(eq(usersTable.id, user.id));
  }
});

test("team reader keeps roster results when another team subsection fails", async () => {
  const storage = {
    getAllUsers: async () => [{
      id: 1,
      email: "hidden@example.test",
      passwordHash: "hidden",
      role: "user",
      displayName: "Available Teammate",
    }],
  } as IStorage;

  const result = await runSeeTeamTool({
    include: ["people", "reflections"],
  }, storage, {
    listSprintReflections: async () => {
      throw new Error("reflection source unavailable");
    },
    listTrackerSprints: async () => [],
  });

  assert.equal(result.isEmpty, false);
  assert.match(result.content, /Available Teammate/);
  assert.match(result.content, /Source unavailable: reflection source unavailable/);
});

test("unfiltered reflections do not depend on sprint metadata", async () => {
  const storage = { getAllUsers: async () => [] } as unknown as IStorage;
  const result = await runSeeTeamTool({
    include: ["reflections"],
  }, storage, {
    listSprintReflections: async () => [{
      id: 1,
      authorId: 1,
      authorName: "Angela",
      sprintId: 72,
      sprintNumber: 72,
      summary: "The launch is on track",
      wastes: [],
      kaizenWhat: "Keep decisions visible",
      kaizenWhy: "Avoid duplicate work",
      kaizenDone: "Updates posted weekly",
      impact: "Faster delivery",
      createdAt: "2026-09-16T00:00:00.000Z",
    }],
    listTrackerSprints: async () => {
      throw new Error("sprint metadata should not be loaded");
    },
  });

  assert.equal(result.isEmpty, false);
  assert.match(result.content, /The launch is on track/);
  assert.doesNotMatch(result.content, /Source unavailable/);
});

test("current-sprint reflection lookup surfaces settings failures", async () => {
  const storage = { getAllUsers: async () => [] } as unknown as IStorage;
  const result = await runSeeTeamTool({
    include: ["reflections"],
    currentSprint: true,
  }, storage, {
    listSprintReflections: async () => [],
    listTrackerSprints: async () => [{ id: 72, number: 72, createdAt: "2026-09-16T00:00:00.000Z" }],
    getSettings: async () => {
      throw new Error("current sprint settings unavailable");
    },
  });

  assert.equal(result.isEmpty, true);
  assert.match(result.content, /Source unavailable: current sprint settings unavailable/);
  assert.doesNotMatch(result.content, /No matching sprint reflections found/);
});