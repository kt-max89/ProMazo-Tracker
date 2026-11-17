// Development-only: real authenticated approval and live refresh, controlled
// model proposals for UI checks, then real model routing checks. Fixtures only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import bcrypt from "bcrypt";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";
import type { Task } from "../shared/schema";
import type { TaskEditChanges } from "../shared/taskEdits";

if (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEPLOYMENT === "1") throw Error("Development preview only");
const suffix = randomUUID(), password = randomUUID();
const browser = await chromium.launch({
  executablePath: existsSync("/repl/tools/bin/chromium") ? "/repl/tools/bin/chromium" : undefined,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", error => errors.push(error.message));
const userIds: number[] = [], taskIds: number[] = [], projectIds: number[] = [], sprintIds: number[] = [];
let proposalChanges: TaskEditChanges = {};
let snapshot: Task;
let approvalPayload: any;
const getTask = async () => (await context.request.get(`/api/tasks/${taskIds[0]}`)).json() as Promise<Task>;
const getActivity = async () => (await context.request.get(`/api/tasks/${taskIds[0]}/activity`)).json();
const countTasks = async () => Number((await pool.query("SELECT count(*) FROM tasks WHERE created_by=$1", [userIds[0]])).rows[0].count);
async function propose(changes: TaskEditChanges) {
  proposalChanges = changes;
  snapshot = await getTask();
  await page.getByTestId("input-query").fill("Review an edit fixture");
  await page.getByTestId("button-send").click();
  await expect(page.getByTestId("task-edit-proposal-review")).toBeVisible();
}
async function approve() {
  await page.getByTestId("button-approve-task-edit").click();
  await expect(page.getByTestId("task-edit-proposal-review")).not.toBeVisible();
}
try {
  const hash = await bcrypt.hash(password, 4);
  const { rows: users } = await pool.query(
    "INSERT INTO users(email,password_hash,display_name,is_active) VALUES($1,$4,$5,true),($2,$4,$6,true),($3,$4,$7,false) RETURNING id",
    [`edit-browser-a-${suffix}@example.test`, `edit-browser-b-${suffix}@example.test`, `edit-browser-c-${suffix}@example.test`, hash, `Editor ${suffix}`, `Other member ${suffix}`, `Inactive member ${suffix}`]);
  userIds.push(...users.map(u => u.id));
  const login = await context.request.post("/api/auth/login", { data: { email: `edit-browser-a-${suffix}@example.test`, password } });
  assert.equal(login.status(), 200);
  const { rows: projects } = await pool.query("INSERT INTO projects(name) VALUES($1),($2) RETURNING id", [`Browser edit project ${suffix}`, `Browser alternate project ${suffix}`]);
  projectIds.push(...projects.map(p => p.id));
  const { rows: milestones } = await pool.query("INSERT INTO milestones(project_id,name) VALUES($1,$2),($3,$4) RETURNING id", [projectIds[0], `First ${suffix}`, projectIds[1], `Second ${suffix}`]);
  const { rows: sprints } = await pool.query("INSERT INTO sprints(number) VALUES(912346) RETURNING id");
  sprintIds.push(sprints[0].id);
  const created = await context.request.post("/api/tasks", { data: {
    title: `Browser chat edit ${suffix}`, description: "Original full description",
    assigneeIds: [userIds[2]], sprintId: null,
  } });
  assert.equal(created.status(), 200);
  taskIds.push((await created.json()).id);
  await page.route("**/api/chat", route => route.fulfill({
    contentType: "text/event-stream",
    body: `data: {"type":"token","data":"Review existing task"}\n\ndata: {"type":"done"}\n\ndata: ${JSON.stringify({
      type: "task_edit_proposal", data: { proposalId: randomUUID(), type: "edit_task", taskId: taskIds[0], currentTask: snapshot, changes: proposalChanges },
    })}\n\n`,
  }));
  await page.route("**/api/task-edit-proposals/approve", async route => {
    approvalPayload = route.request().postDataJSON();
    await route.continue();
  });
  const signedOut = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
  assert.equal((await signedOut.request.post("/api/task-edit-proposals/approve", { data: { taskId: taskIds[0], changes: { status: "done" } } })).status(), 401);
  await signedOut.close();
  let cleared = await getTask();
  let beforeNoOp = await getActivity();
  if (!process.argv.includes("--routing-only")) {
  await page.goto("/");
  const original = await getTask();
  const activityBefore = await getActivity();
  await propose({ status: "needs_review" });
  await expect(page.getByTestId("edit-proposal-status")).toHaveValue("needs_review");
  await expect(page.getByTestId(`edit-proposal-assignee-${userIds[2]}`)).toBeChecked();
  await page.getByRole("button", { name: "Not now", exact: true }).click();
  assert.deepEqual(await getTask(), original);
  assert.deepEqual(await getActivity(), activityBefore);
  assert.equal(await countTasks(), 1);

  await propose({ status: "needs_review" });
  await page.getByTestId("edit-proposal-title").fill(`Edited browser task ${suffix}`);
  await page.getByTestId("edit-proposal-description").fill("Edited exact description");
  await page.getByTestId("edit-proposal-blocked").check();
  await page.getByTestId("edit-proposal-blocked-reason").fill("Needs another review");
  await page.getByTestId("edit-proposal-size").selectOption("XL");
  await page.getByTestId("edit-proposal-due-date").fill("2027-03-19");
  await page.getByTestId("edit-proposal-project").selectOption(String(projectIds[0]));
  await page.getByTestId("edit-proposal-milestone").selectOption(String(milestones[0].id));
  await page.getByTestId("edit-proposal-sprint").selectOption(String(sprintIds[0]));
  await page.getByTestId(`edit-proposal-assignee-${userIds[0]}`).check();
  await page.getByTestId(`edit-proposal-assignee-${userIds[1]}`).check();
  await approve();
  const saved = await getTask();
  assert.equal(saved.id, original.id);
  assert.equal(saved.createdAt, original.createdAt);
  assert.equal(saved.createdBy, userIds[0]);
  assert.equal(saved.status, "needs_review");
  assert.equal(saved.description, "Edited exact description");
  assert.equal(saved.isBlocked, true);
  assert.equal(saved.blockedReason, "Needs another review");
  assert.equal(saved.size, "XL");
  assert.equal(saved.dueDate, "2027-03-19");
  assert.equal(saved.projectId, projectIds[0]);
  assert.equal(saved.milestoneId, milestones[0].id);
  assert.equal(saved.sprintId, sprintIds[0]);
  assert.deepEqual(saved.assigneeIds.sort(), [...userIds].sort());
  assert.equal(await countTasks(), 1);
  const activity = await getActivity();
  assert.ok(activity.some((entry: any) => entry.eventType === "status_changed"));
  assert.ok(activity.some((entry: any) => entry.eventType === "assignees_changed"));
  assert.ok(activity.every((entry: any) => entry.actorId === userIds[0]));
  await propose({ isBlocked: false });
  await expect(page.getByTestId("edit-proposal-blocked-reason")).toHaveValue("");
  await approve();
  assert.deepEqual(approvalPayload.changes, { isBlocked: false, blockedReason: null });
  assert.equal((await getTask()).blockedReason, null);
  await context.request.patch(`/api/tasks/${taskIds[0]}`, { data: { isBlocked: true, blockedReason: saved.blockedReason } });

  // Partial updates submit ONLY requested fields; a remote save does not replace
  // the draft or its untouched snapshot until an explicit reload.
  await propose({ description: "Local draft preserved" });
  const detailPage = await context.newPage();
  await detailPage.goto(`/tasks/${taskIds[0]}`);
  const remoteUpdate = await context.request.patch(`/api/tasks/${taskIds[0]}`, { data: { title: `Remote title ${suffix}` } });
  assert.equal(remoteUpdate.status(), 200);
  await expect(page.getByText(/This task changed elsewhere/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("edit-proposal-description")).toHaveValue("Local draft preserved");
  await expect(page.getByTestId("edit-proposal-title")).toHaveValue(saved.title);
  await page.getByRole("button", { name: /Reload current snapshot/ }).click();
  await expect(page.getByTestId("edit-proposal-title")).toHaveValue(`Remote title ${suffix}`);
  await expect(page.getByTestId("edit-proposal-description")).toHaveValue("Local draft preserved");
  await approve();
  assert.deepEqual(approvalPayload.changes, { description: "Local draft preserved" });
  await expect(detailPage.getByText("Local draft preserved", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await detailPage.close();

  // Invalid approval remains visible, keeps local inputs and performs no writes.
  await propose({ blockedReason: null });
  const beforeInvalid = await getTask();
  await page.getByTestId("button-approve-task-edit").click();
  await expect(page.getByText("Approval failed")).toBeVisible();
  await expect(page.getByTestId("task-edit-proposal-review")).toBeVisible();
  assert.deepEqual(await getTask(), beforeInvalid);
  await page.getByTestId("edit-proposal-blocked").uncheck();
  await page.getByTestId("edit-proposal-description").fill("");
  await page.getByTestId("edit-proposal-size").selectOption("none");
  await page.getByTestId("edit-proposal-due-date").fill("");
  await page.getByTestId("edit-proposal-project").selectOption("none");
  await page.getByTestId("edit-proposal-sprint").selectOption("backlog");
  for (const id of userIds) await page.getByTestId(`edit-proposal-assignee-${id}`).uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  await approve();
  cleared = await getTask();
  for (const field of ["description", "blockedReason", "size", "dueDate", "projectId", "milestoneId", "sprintId"] as const) assert.equal(cleared[field], null);
  assert.equal(cleared.isBlocked, false);
  assert.deepEqual(cleared.assigneeIds, []);
  assert.equal(cleared.title, beforeInvalid.title);
  assert.equal(cleared.status, beforeInvalid.status);
  assert.equal(await countTasks(), 1);
  beforeNoOp = await getActivity();
  await propose({ status: cleared.status });
  await approve();
  assert.deepEqual(await getActivity(), beforeNoOp);
  for (const invalid of [
    { taskId: "bad", changes: { title: "bad" } },
    { taskId: taskIds[0], changes: { dueDate: "2026-02-30" } },
    { taskId: taskIds[0], changes: { assigneeIds: [2147483647] } },
    { taskId: taskIds[0], changes: { status: "invalid" } },
    { taskId: taskIds[0], changes: { projectId: 2147483647, milestoneId: null } },
    { taskId: taskIds[0], changes: { sprintId: 2147483647 } },
    { taskId: taskIds[0], changes: { title: "bad", createdBy: userIds[1] } },
  ]) assert.equal((await context.request.post("/api/task-edit-proposals/approve", { data: invalid })).status(), 400);
  assert.deepEqual(await getActivity(), beforeNoOp);
  assert.equal(await countTasks(), 1);
  }

  // End-to-end real model routing/proposals, never approved, no task writes.
  if (!process.argv.includes("--ui-only")) {
  await page.unroute("**/api/chat");
  const session = await (await context.request.post("/api/chat-sessions", { data: { title: "Edit routing fixture" } })).json();
  async function chat(query: string) {
    const response = await context.request.post("/api/chat", { data: { query, sessionId: session.id }, timeout: 90_000 });
    assert.equal(response.status(), 200);
    return (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  }
  try {
    const identified = await chat(`Set task #${taskIds[0]} to done and change size to S. Do not create a new task.`);
    const edit = identified.find(event => event.type === "task_edit_proposal")?.data;
    assert.equal(edit?.taskId, taskIds[0], JSON.stringify(identified));
    assert.deepEqual(edit.changes, { status: "done", size: "S" });
    const followup = await chat("Also clear its due date and move it to backlog.");
    assert.deepEqual(followup.find(event => event.type === "task_edit_proposal")?.data.changes, { dueDate: null, sprintId: null }, JSON.stringify(followup));
    const full = await chat(`For task #${taskIds[0]}, propose these exact edits only: title "Full chat fixture ${suffix}", description "Exact chat description", status in progress, blocked with reason "Waiting for approval", size XS, due date 2027-04-05, assignees user IDs ${userIds[0]} and ${userIds[1]} (replace the list), project ID ${projectIds[0]}, milestone ID ${milestones[0].id}, sprint ID ${sprintIds[0]}.`);
    const fullEdit = full.find(event => event.type === "task_edit_proposal")?.data;
    assert.equal(fullEdit?.taskId, taskIds[0], JSON.stringify(full));
    assert.deepEqual(fullEdit?.changes, {
      title: `Full chat fixture ${suffix}`, description: "Exact chat description", status: "in_progress",
      isBlocked: true, blockedReason: "Waiting for approval", size: "XS", dueDate: "2027-04-05",
      assigneeIds: [userIds[0], userIds[1]], projectId: projectIds[0], milestoneId: milestones[0].id, sprintId: sprintIds[0],
    });
    const fullClear = await chat(`For task #${taskIds[0]}: clear description, due date and size, remove all assignees, detach project and milestone together, move to backlog, and mark unblocked with no blocked reason. Do not change title or status.`);
    assert.deepEqual(fullClear.find(event => event.type === "task_edit_proposal")?.data.changes, {
      description: null, dueDate: null, size: null, assigneeIds: [], projectId: null,
      milestoneId: null, sprintId: null, isBlocked: false, blockedReason: null,
    }, JSON.stringify(fullClear));
    const read = await chat(`What is the status of task #${taskIds[0]}? Do not edit anything.`);
    assert.ok(!read.some(event => event.type === "task_edit_proposal" || event.type === "task_proposal"));
    const missing = await chat("Set task #2147483647 to done.");
    assert.ok(!missing.some(event => event.type === "task_edit_proposal" || event.type === "task_proposal"));
    const self = await chat(`Assign task #${taskIds[0]} only to me, replacing all current assignees.`);
    assert.deepEqual(self.find(event => event.type === "task_edit_proposal")?.data.changes, { assigneeIds: [userIds[0]] }, JSON.stringify(self));
    const missingRef = await chat(`Move task #${taskIds[0]} to project "No such edit fixture project ${suffix}".`);
    assert.ok(!missingRef.some(event => event.type === "task_edit_proposal" || event.type === "task_proposal"));
    const duplicateName = `Duplicate edit member ${suffix}`;
    await pool.query("UPDATE users SET display_name=$1 WHERE id=ANY($2::int[])", [duplicateName, userIds.slice(0, 2)]);
    const ambiguousRef = await chat(`Assign task #${taskIds[0]} to "${duplicateName}".`);
    assert.ok(!ambiguousRef.some(event => event.type === "task_edit_proposal" || event.type === "task_proposal"));
    const duplicate = await context.request.post("/api/tasks", { data: { title: cleared.title, sprintId: null } });
    taskIds.push((await duplicate.json()).id);
    const ambiguous = await chat(`Mark the task named "${cleared.title}" as done. I mean that name, not a prior ID.`);
    assert.ok(!ambiguous.some(event => event.type === "task_edit_proposal" || event.type === "task_proposal"));
    assert.deepEqual(await getActivity(), beforeNoOp);
    assert.equal(await countTasks(), 2);
  } finally {
    await context.request.delete(`/api/chat-sessions/${session.id}`);
  }
  }
  assert.deepEqual(errors, []);
  console.log(process.argv.includes("--routing-only")
    ? "Chat edit live-model checks passed: full fields, clears, follow-up targeting, latest-turn changes, read-only questions, missing/ambiguous targets and references, assign me, no writes."
    : process.argv.includes("--ui-only")
      ? "Chat edit browser UI checks passed: all fields, clears, partial updates, dismissal, invalid approvals, live draft preservation, activity, no-op, authentication."
      : "Chat edit browser checks passed: all fields, clears, partial updates, dismissal, invalid approvals, live draft preservation, activity, no-op, auth, and live-model targeting/follow-ups/references.");
} catch (error) {
  console.error("Chat edit browser check failed:", error);
  throw error;
} finally {
  await context.request.post("/api/auth/logout").catch(() => {});
  await browser.close();
  if (taskIds.length) {
    await pool.query("DELETE FROM task_assignees WHERE task_id=ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM task_activity WHERE task_id=ANY($1::int[])", [taskIds]);
    await pool.query("DELETE FROM tasks WHERE id=ANY($1::int[])", [taskIds]);
  }
  if (projectIds.length) {
    await pool.query("DELETE FROM milestones WHERE project_id=ANY($1::int[])", [projectIds]);
    await pool.query("DELETE FROM projects WHERE id=ANY($1::int[])", [projectIds]);
  }
  if (sprintIds.length) await pool.query("DELETE FROM sprints WHERE id=ANY($1::int[])", [sprintIds]);
  if (userIds.length) {
    await pool.query("DELETE FROM chat_messages WHERE session_id IN (SELECT id FROM chat_sessions WHERE user_id=ANY($1::int[]))", [userIds]);
    await pool.query("DELETE FROM chat_sessions WHERE user_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM presence_leases WHERE user_id=ANY($1::int[])", [userIds]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  }
  await pool.end();
}
