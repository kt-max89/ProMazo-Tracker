import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../server/db";
import { buildPrompt } from "../server/promptBuilder";
import { validateProposal } from "../server/proposalSchema";
import { settleReadToolCalls } from "../server/readToolExecution";
import { runSeeTeamTool } from "../server/seeTeamTool";
import { runSeeTasksTool } from "../server/seeTasksTool";
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
import { LOOKUP_RULES, LOOKUP_TOOLS } from "../server/lookupTools";

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

test("creation loop requests topic-based search while the legacy gate only selects edits", () => {
  assert.match(LOOKUP_RULES, /For task creation, call see_tasks/);
  assert.match(LOOKUP_RULES, /meaningful topic keywords/);
  assert.match(LOOKUP_RULES, /duplicates or related tasks/);
  assert.match(LOOKUP_RULES, /across assignees\/statuses\/sprints unless the user requested/);
  assert.match(String(buildRouterMessages("Edit task 10")[0].content), /edit an existing task/);
  assert.equal(LOOKUP_TOOLS.length, 5);
  assert.ok(!LOOKUP_TOOLS.some(tool => tool.name === "prepare_task_edit"));
  const calls = normalizeToolCalls([{ name: "see_tasks", arguments: JSON.stringify({
    query: "launch handoff", mode: "matching_tasks",
  }) }], "Create a task to review the launch handoff");
  assert.equal(calls[0].intent, "SEE_TASKS");
  assert.equal((calls[0].args as { query?: string }).query, "launch handoff");
});

test("authenticated account role is supplied for creation, reads and edits without granting authority", () => {
  for (const role of ["admin", "user"]) {
    for (const edit of [false, true]) {
      const messages = buildPrompt({
        message: "Help with this task", currentUserName: "Viewer", currentUserRole: role,
        ...(edit ? { toolResults: [{ type: "task_edit" as const, content: "Current task", isEmpty: false }] } : {}),
      });
      const context = messages.filter(message => message.role === "system").map(message => message.content).join("\n");
      assert.ok(context.includes(`CURRENT USER ROLE: ${role}`));
      assert.match(context, /does not override application authorization or review requirements/);
    }
  }
  assert.doesNotMatch(buildPrompt({ message: "Hello" }).map(m => m.content).join("\n"), /CURRENT USER ROLE: undefined/);
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

test("task prompt requires nested, verifiable completion criteria without changing proposal defaults", () => {
  const prompt = String(buildPrompt({ message: "Draft a task" })[0].content);
  assert.match(prompt, /include a "description" for every proposed task/);
  assert.match(prompt, /exactly three top-level markdown sections/);
  assert.match(prompt, /nested "### Definition of Done" subsection within Resources \/ Context/);
  assert.match(prompt, /concrete, observable, verifiable outcomes specific to the task/);
  assert.match(prompt, /Use the user's supplied requirements and acceptance criteria/);
  assert.match(prompt, /Even with no supplied resources, infer meaningful completion criteria/);
  assert.match(prompt, /Do not invent resources, links, people, deadlines, numerical targets, approvals/);
  assert.match(prompt, /"assignedToName": always default to the CURRENT USER/);
  assert.match(prompt, /"dueDate": always include tomorrow's date/);
  assert.match(prompt, /Never set "status" in a proposal/);
});

test("prompt JSON example keeps three sections and Definition of Done through proposal validation and edits", () => {
  const prompt = String(buildPrompt({ message: "Draft a task" })[0].content);
  const exampleText = prompt.slice(prompt.indexOf('{\n  "answer"'), prompt.indexOf("\n\nIf you do not want"));
  const example = JSON.parse(exampleText);
  assert.deepEqual(Object.keys(example.proposal), ["type", "tasks"]);
  const draft = example.proposal.tasks[0];
  assert.deepEqual(Object.keys(draft), [
    "title", "description", "assignedToName", "projectName", "milestoneName", "dueDate",
  ]);
  assert.deepEqual(draft.description.match(/^## .+$/gm), [
    "## What & Why", "## Steps", "## Resources / Context",
  ]);
  assert.match(draft.description, /## Resources \/ Context\nNone provided\.\n\n### Definition of Done\n- .+\n- .+/);
  const validated = validateProposal(example.proposal);
  assert.ok(validated);
  assert.equal(validated.tasks[0].description, draft.description);

  // The review form sends the edited description back through the same validator.
  const editedDescription = draft.description.replace(
    "longer drafts scroll internally",
    "longer drafts scroll internally on desktop and narrow screens",
  );
  const approved = validateProposal(JSON.parse(JSON.stringify({
    type: validated.type,
    tasks: [{ ...validated.tasks[0], description: editedDescription }],
  })));
  assert.ok(approved);
  assert.equal(approved.tasks[0].description, editedDescription);
  assert.match(approved.tasks[0].description!, /### Definition of Done/);
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
      dueDate: "2030-01-02",
      size: "M",
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
    const related = await runSeeTasksTool({
      query: "unmatchedtopic HANDOFF", project: project.name, mode: "matching_tasks",
    });
    assert.deepEqual(related.tasks.map(task => task.id).sort(), insertedTasks.map(task => task.id).sort());
    assert.equal(related.counts.in_progress, 1);
    assert.equal(related.counts.done, 1);
    assert.match(related.content, /Due: 2030-01-02 \| Size: M \| Sprint: \d+/);
    assert.ok(related.content.includes(`Sprint: ${sprint.number}`));
    assert.match(related.content, /Due: Not set \| Size: Not set/);
    // Fuzzy discovery must not loosen identity resolution for existing-task edits.
    assert.deepEqual(await queryTasks({ query: "unmatchedtopic handoff", projectIds: [project.id] }), []);
    assert.deepEqual(await queryTasks({ query: "%", queryMatch: "any_word", projectIds: [project.id] }), []);
    await db.update(tasksTable).set({ sprintId: null }).where(eq(tasksTable.id, insertedTasks[1].id));
    assert.match((await runSeeTasksTool({ query: suffix, project: project.name })).content, /Sprint: Backlog/);
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
    }, storage, authenticatedUser);
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
  }, storage, { id: 1, role: "user", displayName: "Viewer" }, {
    getReflectionAccess: async () => [],
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
  }, storage, { id: 1, role: "user", displayName: "Viewer" }, {
    getReflectionAccess: async () => [],
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
  }, storage, { id: 1, role: "user", displayName: "Viewer" }, {
    getReflectionAccess: async () => [],
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