import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { insertTaskSchema, taskStatuses, updateTaskSchema } from "../shared/schema";

test("every board status is accepted when creating and updating tasks", () => {
  for (const status of taskStatuses) {
    assert.equal(insertTaskSchema.safeParse({ title: "Task", status }).success, true);
    assert.equal(updateTaskSchema.safeParse({ status }).success, true);
  }
});

test("Needs review transitions are accepted in both directions", () => {
  const intoNeedsReview = updateTaskSchema.parse({ status: "needs_review" });
  const outOfNeedsReview = updateTaskSchema.parse({ status: "done" });

  assert.equal(intoNeedsReview.status, "needs_review");
  assert.equal(outOfNeedsReview.status, "done");
});

test("unsupported status updates are rejected", () => {
  assert.equal(updateTaskSchema.safeParse({ status: "review" }).success, false);
});

test("Needs review transitions persist in PostgreSQL", {
  skip: !process.env.DATABASE_URL && "DATABASE_URL is not configured",
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: number }>(
      "INSERT INTO tasks (title, status) VALUES ($1, $2) RETURNING id",
      ["Needs review transition regression", "not_started"],
    );
    const taskId = inserted.rows[0].id;

    const movedIn = await client.query<{ status: string }>(
      "UPDATE tasks SET status = $1 WHERE id = $2 RETURNING status",
      ["needs_review", taskId],
    );
    assert.equal(movedIn.rows[0].status, "needs_review");

    const refreshedIn = await client.query<{ status: string }>(
      "SELECT status FROM tasks WHERE id = $1",
      [taskId],
    );
    assert.equal(refreshedIn.rows[0].status, "needs_review");

    const movedOut = await client.query<{ status: string }>(
      "UPDATE tasks SET status = $1 WHERE id = $2 RETURNING status",
      ["done", taskId],
    );
    assert.equal(movedOut.rows[0].status, "done");

    const refreshedOut = await client.query<{ status: string }>(
      "SELECT status FROM tasks WHERE id = $1",
      [taskId],
    );
    assert.equal(refreshedOut.rows[0].status, "done");
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});