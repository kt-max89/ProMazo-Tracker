import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

test("task activity endpoint requires authentication", async () => {
  const routes = await readFile(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /app\.get\("\/api\/tasks\/:id\/activity", requireAuth,/);
});

test("task activity records mutations, suppresses no-ops, preserves actors, and supports legacy tasks", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const { createTask, updateTask, archiveTask, restoreTask } = await import("../server/taskService");
  const { createComment } = await import("../server/commentService");
  const { listTaskActivity } = await import("../server/taskActivityService");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const taskIds: number[] = [];
  const userIds: number[] = [];

  try {
    const actor = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, role, display_name)
       VALUES ($1, 'test', 'user', 'Activity Actor') RETURNING id`,
      [`activity-actor-${suffix}@example.com`],
    );
    const assignee = await pool.query<{ id: number }>(
      `INSERT INTO users (email, password_hash, role, display_name)
       VALUES ($1, 'test', 'user', 'Activity Assignee') RETURNING id`,
      [`activity-assignee-${suffix}@example.com`],
    );
    const actorId = actor.rows[0].id;
    const assigneeId = assignee.rows[0].id;
    userIds.push(actorId, assigneeId);

    const task = await createTask({
      title: "Activity coverage",
      createdBy: actorId,
      assigneeIds: [assigneeId],
      sprintId: null,
    });
    taskIds.push(task.id);

    await updateTask(task.id, { status: "in_progress" }, actorId);
    await updateTask(task.id, {
      title: "Activity coverage updated",
      description: "New description",
      dueDate: "2026-09-30",
      size: "M",
      isBlocked: true,
      blockedReason: "Waiting",
      assigneeIds: [],
    }, actorId);
    const beforeNoOp = await listTaskActivity(task.id);
    await updateTask(task.id, {
      title: "Activity coverage updated",
      description: "New description",
      status: "in_progress",
      assigneeIds: [],
    }, actorId);
    const afterNoOp = await listTaskActivity(task.id);
    assert.equal(afterNoOp?.length, beforeNoOp?.length);

    await createComment({ taskId: task.id, authorId: actorId, body: "History comment" });
    await archiveTask(task.id, actorId);
    await restoreTask(task.id, actorId);

    const activity = await listTaskActivity(task.id);
    assert.ok(activity);
    assert.deepEqual(
      activity.map(item => item.eventType),
      ["created", "assignees_changed", "status_changed", "assignees_changed", "updated", "commented", "archived", "restored"],
    );
    assert.equal(activity.every((item, index) =>
      index === 0 || item.createdAt >= activity[index - 1].createdAt
    ), true);
    assert.deepEqual(activity.find(item => item.eventType === "status_changed")?.metadata, {
      from: "not_started",
      to: "in_progress",
    });
    assert.deepEqual(
      activity.filter(item => item.eventType === "assignees_changed").map(item => item.metadata),
      [
        { added: ["Activity Assignee"], removed: [] },
        { added: [], removed: ["Activity Assignee"] },
      ],
    );
    const updatedFields = (activity.find(item => item.eventType === "updated")?.metadata.fields as Array<{ field: string }>);
    assert.deepEqual(
      updatedFields.map(item => item.field),
      ["title", "description", "due date", "size", "blocked state", "blocked reason"],
    );

    await pool.query("DELETE FROM users WHERE id = $1", [actorId]);
    userIds.splice(userIds.indexOf(actorId), 1);
    const afterActorDeletion = await listTaskActivity(task.id);
    assert.equal(afterActorDeletion?.every(item => item.actorName === "Activity Actor"), true);
    assert.equal(afterActorDeletion?.every(item => item.actorId === null), true);

    const legacy = await pool.query<{ id: number }>(
      "INSERT INTO tasks (title, status, created_by, sprint_id) VALUES ($1, 'not_started', $2, NULL) RETURNING id",
      ["Legacy task", assigneeId],
    );
    taskIds.push(legacy.rows[0].id);
    const legacyActivity = await listTaskActivity(legacy.rows[0].id);
    assert.equal(legacyActivity?.length, 1);
    assert.equal(legacyActivity?.[0].eventType, "created");
    assert.equal(legacyActivity?.[0].synthetic, true);
    assert.equal(legacyActivity?.[0].actorName, "Activity Assignee");
  } finally {
    if (taskIds.length) {
      await pool.query("DELETE FROM tasks WHERE id = ANY($1::int[])", [taskIds]);
    }
    if (userIds.length) {
      await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]);
    }
    await pool.end();
  }
});