import { asc, eq } from "drizzle-orm";
import { db } from "./db";
import { taskCommentsTable, tasksTable, usersTable } from "./schema";
import type { TaskComment } from "@shared/schema";
import { getActorName, recordTaskActivity } from "./taskActivityService";

function mapComment(
  row: typeof taskCommentsTable.$inferSelect & { authorName: string | null }
): TaskComment {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

export async function listCommentsByTaskId(taskId: number): Promise<TaskComment[]> {
  const rows = await db
    .select({
      id: taskCommentsTable.id,
      taskId: taskCommentsTable.taskId,
      authorId: taskCommentsTable.authorId,
      authorName: usersTable.displayName,
      body: taskCommentsTable.body,
      createdAt: taskCommentsTable.createdAt,
    })
    .from(taskCommentsTable)
    .leftJoin(usersTable, eq(taskCommentsTable.authorId, usersTable.id))
    .where(eq(taskCommentsTable.taskId, taskId))
    .orderBy(asc(taskCommentsTable.createdAt));
  return rows.map((row) => mapComment({ ...row, authorName: row.authorName ?? null }));
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

  const actorName = await getActorName(input.authorId);
  return db.transaction(async tx => {
    const [row] = await tx
      .insert(taskCommentsTable)
      .values({
        taskId: input.taskId,
        authorId: input.authorId,
        body: input.body.trim(),
      })
      .returning();
    await recordTaskActivity(tx, {
      taskId: input.taskId,
      actorId: input.authorId,
      actorName,
      eventType: "commented",
      metadata: { commentId: row.id },
    });
    return mapComment({ ...row, authorName: actorName });
  });
}
