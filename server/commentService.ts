import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { taskCommentsTable, tasksTable } from "./schema";
import type { TaskComment } from "@shared/schema";

function mapComment(row: typeof taskCommentsTable.$inferSelect): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function listCommentsByTaskId(taskId: number): Promise<TaskComment[]> {
  const rows = await db
    .select()
    .from(taskCommentsTable)
    .where(eq(taskCommentsTable.taskId, taskId))
    .orderBy(asc(taskCommentsTable.createdAt));
  return rows.map(mapComment);
}

export async function createComment(input: {
  taskId: number;
  authorId: number;
  body: string;
}): Promise<TaskComment> {
  if (!input.body?.trim()) {
    throw new Error("Comment body is required");
  }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, input.taskId));
  if (!task) throw new Error("Task not found");

  const [row] = await db
    .insert(taskCommentsTable)
    .values({
      taskId: input.taskId,
      authorId: input.authorId,
      body: input.body.trim(),
    })
    .returning();
  return mapComment(row);
}
