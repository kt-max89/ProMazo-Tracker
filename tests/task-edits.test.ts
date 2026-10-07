import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { randomUUID } from "node:crypto";
import { Completions } from "openai/resources/chat/completions";
import { reviewedTaskEditSchema, modelTaskEditSchema, effectiveTaskEditChanges } from "../shared/taskEdits";
import { normalizeToolCalls, buildRouterMessages, buildEditRequestMessages, groundEditTarget } from "../server/toolIntentSelector";
import { buildPrompt } from "../server/promptBuilder";
import { validateProposal } from "../server/proposalSchema";
import type { IStorage } from "../server/storage";

test("edit contract supports all fields, explicit clears, and rejects defaults/system fields/malformed edits", () => {
  const fields = {
    title: "New title", description: "Exact prose, no template", status: "needs_review",
    isBlocked: true, blockedReason: "Waiting", size: "XXL", dueDate: "2028-02-29",
    assigneeIds: [1, 2], projectId: 3, milestoneId: 4, sprintId: 5,
  };
  assert.deepEqual(reviewedTaskEditSchema.parse({ taskId: 1, changes: fields }).changes, fields);
  const clears = { description: null, isBlocked: false, blockedReason: null, size: null, dueDate: null, assigneeIds: [], projectId: null, milestoneId: null, sprintId: null };
  assert.deepEqual(reviewedTaskEditSchema.parse({ taskId: 1, changes: clears }).changes, clears);
  assert.deepEqual(reviewedTaskEditSchema.parse({ taskId: 1, changes: { status: "done" } }).changes, { status: "done" });
  for (const changes of [
    {}, { title: " " }, { status: "blocked" }, { dueDate: "2026-02-30" }, { dueDate: "tomorrow" },
    { dueDate: "2026-13-01" }, { size: "huge" }, { isBlocked: "true" }, { title: null },
    { assigneeIds: null }, { assigneeIds: [1, 1] }, { assigneeIds: ["1"] },
    { projectId: 0 }, { milestoneId: -1 }, { sprintId: 1.5 },
    ...["id", "createdBy", "createdAt", "updatedAt", "isArchived", "archivedAt", "comments"].map(field => ({ title: "valid", [field]: 1 })),
  ]) assert.equal(reviewedTaskEditSchema.safeParse({ taskId: 1, changes }).success, false, JSON.stringify(changes));
  for (const taskId of [null, 0, -1, 1.1, "1"]) {
    assert.equal(reviewedTaskEditSchema.safeParse({ taskId, changes: { title: "valid" } }).success, false);
  }
  assert.equal(reviewedTaskEditSchema.safeParse({ taskId: 1, changes: fields, tasks: [] }).success, false);
  assert.equal(modelTaskEditSchema.safeParse({ type: "create_task", taskId: 1, changes: fields }).success, false);
  assert.equal(validateProposal({ type: "edit_task", taskId: 1, changes: fields }), null);
  assert.equal(validateProposal({ type: "create_task", tasks: [{ title: "Creation remains supported" }] })?.tasks[0].title, "Creation remains supported");
  assert.deepEqual(effectiveTaskEditChanges({ isBlocked: false }), { isBlocked: false, blockedReason: null });
});

test("edit routing is separate and receives explicit follow-up context; prompt excludes creation defaults", () => {
  const calls = normalizeToolCalls([{ name: "prepare_task_edit", arguments: '{"taskId":123,"fields":["status"]}' }], "mark task #123 done");
  assert.deepEqual(calls, [{ intent: "PREPARE_TASK_EDIT", args: { taskId: 123, taskName: undefined, fields: ["status"] } }]);
  assert.equal(normalizeToolCalls([{ name: "prepare_task_edit", arguments: '{"taskId":1.7}' }], "edit")[0].args.taskId, undefined);
  const messages = buildRouterMessages("Also clear its due date", [{ role: "user", content: "Set task #123 to Needs review" }]);
  assert.match(String(messages[0].content), /requests to edit an existing task/);
  assert.ok(messages.some(message => String(message.content).includes("task #123")));
  const prompt = buildPrompt({ message: "Clear its date", toolResults: [{ type: "task_edit", content: '{"task":{"id":123}}', isEmpty: false }] });
  assert.match(String(prompt[0].content), /NO creation defaults/);
  assert.ok(!prompt.some(message => String(message.content).includes("TOMORROW'S DATE:")));
  assert.match(String(prompt[0].content), /ambiguous\/missing/);
  assert.match(String(prompt.at(-1)?.content), /full current task/);
  const followup = buildPrompt({ message: "Also clear its date", history: [{ role: "user", content: "Mark task #123 done" }],
    toolResults: [{ type: "task_edit", content: '{"task":{"id":123}}', isEmpty: false }] });
  assert.ok(!followup.some(message => String(message.content).includes("Mark task #123 done")));
  const isolated = buildEditRequestMessages("Assign it only to me", { taskId: 123, fields: ["status"], references: { assigneeIds: [2, 3] } });
  assert.equal(isolated[1].content, "Assign it only to me");
  assert.ok(!isolated[0].content.includes('"assigneeIds":[2,3]'));
  assert.ok(!isolated[0].content.includes('"fields":["status"]'));
  const known = [{ role: "assistant" as const, content: "Review\n\nReview proposed changes to task #123 (Existing task).\n\nNothing is saved until you approve task #123." }];
  assert.equal(groundEditTarget("Also clear its date", known, { taskName: "it" }).taskId, 123);
  assert.equal(groundEditTarget("Set task #456 done", known, { taskId: 123 }).taskId, 456);
  assert.equal(groundEditTarget("Set task #123 and task #456 done", known, { taskId: 123 }).taskId, undefined);
  assert.equal(groundEditTarget('Edit task "Different name"', known, { taskName: "Different name" }).taskId, undefined);
  assert.equal(groundEditTarget("Also update Different name and clear its date", known, { taskName: "Different name" }).taskId, undefined);
  assert.equal(groundEditTarget('Change its title to "Task #456"', known, {}).taskId, 123);
});

test("named edit references require unique exact/partial matches and never pick a first ambiguous match", async () => {
  const { uniqueEditReference } = await import("../server/taskEditService");
  const rows = [{ id: 1, name: "Alex" }, { id: 2, name: "Alex" }, { id: 3, name: "Alexandra" }];
  assert.throws(() => uniqueEditReference(rows, "Alex", "Assignee"), /ambiguous/);
  assert.throws(() => uniqueEditReference(rows, "Missing", "Assignee"), /not found/);
  assert.equal(uniqueEditReference(rows, "Alexandra", "Assignee").id, 3);
  assert.throws(() => uniqueEditReference(rows, "Ale", "Assignee"), /ambiguous/);
});

test("full edit approval, target resolution, invalid edits, no-op history, and manual activity equivalence", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const { pool } = await import("../server/db");
  const { storage } = await import("../server/storage");
  const { createTask, updateTask, getTask } = await import("../server/taskService");
  const { listTaskActivity } = await import("../server/taskActivityService");
  const { prepareTaskEdit, buildTaskEditProposal, approveTaskEdit } = await import("../server/taskEditService");
  const { handleChatMessage } = await import("../server/chatOrchestrator");
  const suffix = randomUUID();
  const taskIds: number[] = [], userIds: number[] = [], projectIds: number[] = [], sprintIds: number[] = [];
  try {
    const { rows: users } = await pool.query("INSERT INTO users(email,password_hash,display_name,is_active) VALUES($1,'fixture','Edit Actor',true),($2,'fixture','Cross-team active',true),($3,'fixture','Retained inactive',false) RETURNING id", [`edit-a-${suffix}@example.test`, `edit-b-${suffix}@example.test`, `edit-c-${suffix}@example.test`]);
    userIds.push(...users.map(u => u.id));
    const actor = (await storage.getUser(userIds[0]))!;
    const { rows: projects } = await pool.query("INSERT INTO projects(name) VALUES($1),($2) RETURNING id", [`Edit project ${suffix}`, `Other project ${suffix}`]);
    projectIds.push(...projects.map(p => p.id));
    const { rows: milestones } = await pool.query("INSERT INTO milestones(project_id,name) VALUES($1,$2),($3,$4) RETURNING id", [projectIds[0], `Edit milestone ${suffix}`, projectIds[1], `Other milestone ${suffix}`]);
    const { rows: sprints } = await pool.query("INSERT INTO sprints(number) VALUES(912345),(912347) RETURNING id");
    sprintIds.push(...sprints.map(s => s.id));
    const initial = { title: `Edit target ${suffix}`, description: "x".repeat(400) + "KEEP THE END", createdBy: actor.id, assigneeIds: [userIds[2]], sprintId: null };
    const target = await createTask(initial);
    const manual = await createTask({ ...initial, title: `Manual target ${suffix}` });
    taskIds.push(target.id, manual.id);
    const context = await prepareTaskEdit({ taskId: target.id }, storage);
    assert.equal(context.task?.description, initial.description);
    assert.match(context.content, /KEEP THE END/);
    assert.ok(context.content.includes(String(milestones[0].id)));
    assert.equal((await prepareTaskEdit({ taskName: initial.title }, storage)).task?.id, target.id);
    assert.equal((await prepareTaskEdit({ taskId: target.id, references: { projectName: `Edit project ${suffix}`, milestoneName: `Edit milestone ${suffix}` } }, storage)).task?.id, target.id);
    assert.equal((await prepareTaskEdit({ taskId: target.id, references: { projectName: "No such fixture project" } }, storage)).task, undefined);
    const me = await prepareTaskEdit({ taskId: target.id, references: { assigneeNames: ["me"] } }, storage, actor.id);
    assert.match(me.content, new RegExp(`"signedInUserId":${actor.id}`));
    assert.equal((await prepareTaskEdit({}, storage)).task, undefined);
    assert.equal((await prepareTaskEdit({ taskId: 2147483647 }, storage)).task, undefined);
    const duplicate = await createTask({ title: initial.title, sprintId: null });
    taskIds.push(duplicate.id);
    assert.equal((await prepareTaskEdit({ taskName: initial.title }, storage)).task, undefined);
    // More matches than the display cap must still be ambiguous.
    for (let i = 0; i < 21; i++) {
      const extra = await createTask({ title: `Ambiguous edit ${suffix} ${i}`, sprintId: null });
      taskIds.push(extra.id);
    }
    const partial = await prepareTaskEdit({ taskName: `Ambiguous edit ${suffix}` }, storage);
    assert.equal(partial.task, undefined);
    assert.match(partial.content, /21 total/);
    const changes = {
      title: `Edited ${suffix}`, description: "Exact updated description", status: "needs_review" as const,
      isBlocked: true, blockedReason: "Waiting for review", size: "M" as const, dueDate: "2028-02-29",
      assigneeIds: [userIds[1], userIds[2]], projectId: projectIds[0], milestoneId: milestones[0].id, sprintId: sprintIds[0],
    };
    const activityBefore = await listTaskActivity(target.id);
    const proposal = await buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes }, context, storage);
    assert.ok(proposal);
    const bound = await prepareTaskEdit({ taskId: target.id, fields: ["projectId", "milestoneId", "sprintId", "assigneeIds"], references: {
      projectId: projectIds[0], milestoneId: milestones[0].id, sprintId: sprintIds[0], assigneeIds: [userIds[0]],
    } }, storage);
    for (const wrongReferences of [
      { projectId: projectIds[1], milestoneId: milestones[1].id, sprintId: sprintIds[0], assigneeIds: [userIds[0]] },
      { projectId: projectIds[0], milestoneId: milestones[1].id, sprintId: sprintIds[0], assigneeIds: [userIds[0]] },
      { projectId: projectIds[0], milestoneId: milestones[0].id, sprintId: sprints[1].id, assigneeIds: [userIds[0]] },
      { projectId: projectIds[0], milestoneId: milestones[0].id, sprintId: sprintIds[0], assigneeIds: [userIds[1]] },
    ]) await assert.rejects(buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes: wrongReferences }, bound, storage), /does not match|do not match/);
    const add = await prepareTaskEdit({ taskId: target.id, fields: ["assigneeIds"], references: { assigneeNames: ["Edit Actor"], assigneeMode: "add" } }, storage);
    assert.deepEqual(add.references?.assigneeIds, [userIds[2], userIds[0]]);
    assert.ok(await buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes: { assigneeIds: [userIds[0], userIds[2]] } }, add, storage));
    const remove = await prepareTaskEdit({ taskId: target.id, fields: ["assigneeIds"], references: { assigneeIds: [userIds[2]], assigneeMode: "remove" } }, storage);
    assert.deepEqual(remove.references?.assigneeIds, []);
    assert.ok(await buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes: { assigneeIds: [] } }, remove, storage));
    assert.deepEqual(await getTask(target.id), target);
    assert.deepEqual(await listTaskActivity(target.id), activityBefore);
    assert.equal(await buildTaskEditProposal({ type: "edit_task", taskId: manual.id, changes }, context, storage), null);
    assert.equal(await buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes }, partial, storage), null);
    for (const invalid of [
      { isBlocked: true }, { projectId: projectIds[0] }, { projectId: projectIds[0], milestoneId: milestones[1].id },
      { milestoneId: milestones[0].id }, { projectId: 2147483647, milestoneId: milestones[0].id },
      { sprintId: 2147483647 }, { assigneeIds: [2147483647] }, { dueDate: "2026-02-30" },
      { status: "invalid" }, { title: "valid", createdBy: userIds[1] },
    ]) {
      await assert.rejects(approveTaskEdit({ taskId: target.id, changes: invalid }, actor.id, storage));
      assert.deepEqual(await getTask(target.id), target);
    }
    await assert.rejects(approveTaskEdit({ taskId: duplicate.id, changes: { assigneeIds: [userIds[2]] } }, actor.id, storage), /active user/);

    // Exercise the real orchestration and router with controlled model outputs.
    const llm = mock.method(Completions.prototype, "create", async (body: any) => body.tools
      ? { choices: [{ message: { tool_calls: [{ type: "function", function: { name: "prepare_task_edit", arguments: JSON.stringify({ taskId: target.id, fields: ["dueDate"] }) } }] } }] }
      : { choices: [{ message: { content: JSON.stringify({ answer: "Please review", editProposal: { type: "edit_task", taskId: target.id, changes: { dueDate: null } } }) } }] });
    const events = [];
    for await (const event of handleChatMessage({ message: `Clear the due date on task #${target.id}`, user: actor, storage })) events.push(event);
    assert.ok(events.find(e => e.type === "task_edit_proposal"));
    assert.equal(events.findIndex(e => e.type === "done") < events.findIndex(e => e.type === "task_edit_proposal"), true);
    assert.equal(events.some(e => e.type === "task_proposal"), false);
    assert.deepEqual(await getTask(target.id), target);
    await assert.rejects(buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes: { dueDate: null, status: "done" } }, { ...context, fields: ["dueDate"] }, storage), /outside your latest request/);
    llm.mock.restore();

    const saved = await approveTaskEdit({ taskId: target.id, changes }, actor.id, storage);
    const unblock = await buildTaskEditProposal({ type: "edit_task", taskId: target.id, changes: { isBlocked: false } },
      { task: saved, fields: ["isBlocked", "blockedReason"], content: "" }, storage);
    assert.deepEqual(unblock?.changes, { isBlocked: false, blockedReason: null });
    assert.equal(saved.id, target.id);
    assert.equal(saved.createdBy, target.createdBy);
    assert.equal(saved.createdAt, target.createdAt);
    for (const [field, value] of Object.entries(changes)) assert.deepEqual(saved[field as keyof typeof saved], value);
    await updateTask(manual.id, changes, actor.id);
    const chatActivity = (await listTaskActivity(target.id))!.slice(activityBefore!.length);
    const manualActivity = (await listTaskActivity(manual.id))!.slice(activityBefore!.length);
    const shape = (rows: typeof chatActivity) => rows.map(({ actorId, actorName, eventType, metadata }) => ({ actorId, actorName, eventType, metadata }));
    assert.deepEqual(shape(chatActivity), shape(manualActivity));
    assert.ok(chatActivity.every(row => row.actorId === actor.id && row.actorName === actor.displayName && !Number.isNaN(Date.parse(row.createdAt))));
    const beforeNoOp = await listTaskActivity(target.id);
    await approveTaskEdit({ taskId: target.id, changes }, actor.id, storage);
    assert.deepEqual(await listTaskActivity(target.id), beforeNoOp);
    await approveTaskEdit({ taskId: target.id, changes: { status: "done" } }, actor.id, storage);
    const partialSaved = (await getTask(target.id))!;
    assert.equal(partialSaved.description, changes.description);
    assert.deepEqual(partialSaved.assigneeIds, changes.assigneeIds);
    await assert.rejects(approveTaskEdit({ taskId: target.id, changes: { blockedReason: null } }, actor.id, storage), /blocked reason/);
    const cleared = await approveTaskEdit({ taskId: target.id, changes: {
      description: null, isBlocked: false, blockedReason: null, size: null, dueDate: null,
      assigneeIds: [], projectId: null, milestoneId: null, sprintId: null,
    } }, actor.id, storage);
    assert.equal(cleared.title, changes.title);
    assert.equal(cleared.status, "done");
    for (const key of ["description", "blockedReason", "size", "dueDate", "projectId", "milestoneId", "sprintId"] as const) assert.equal(cleared[key], null);
    assert.deepEqual(cleared.assigneeIds, []);
    const count = await pool.query("SELECT count(*)::int AS n FROM tasks WHERE id=ANY($1::int[])", [taskIds]);
    assert.equal(count.rows[0].n, taskIds.length);
  } finally {
    mock.restoreAll();
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
    if (userIds.length) await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [userIds]);
  }
});
