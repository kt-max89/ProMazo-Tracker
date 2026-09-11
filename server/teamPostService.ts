import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { teamPostsTable, usersTable } from "./schema";
import type { TeamPost } from "@shared/schema";

type TeamPostRow = {
  id: number;
  authorId: number | null;
  authorName: string | null;
  body: string;
  createdAt: Date | string;
  pinned: boolean;
};

function mapTeamPost(row: TeamPostRow): TeamPost {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    pinned: row.pinned,
  };
}

export async function listTeamPosts(all = false): Promise<TeamPost[]> {
  const query = db
    .select({
      id: teamPostsTable.id,
      authorId: teamPostsTable.authorId,
      authorName: usersTable.displayName,
      body: teamPostsTable.body,
      createdAt: teamPostsTable.createdAt,
      pinned: teamPostsTable.pinned,
    })
    .from(teamPostsTable)
    .leftJoin(usersTable, eq(teamPostsTable.authorId, usersTable.id))
    .orderBy(desc(teamPostsTable.pinned), desc(teamPostsTable.createdAt), desc(teamPostsTable.id));

  const rows = all ? await query : await query.limit(5);
  return rows.map(mapTeamPost);
}

export async function createTeamPost(input: { authorId: number; body: string }): Promise<TeamPost> {
  const [row] = await db
    .insert(teamPostsTable)
    .values({ authorId: input.authorId, body: input.body.trim() })
    .returning();

  const [created] = await db
    .select({
      id: teamPostsTable.id,
      authorId: teamPostsTable.authorId,
      authorName: usersTable.displayName,
      body: teamPostsTable.body,
      createdAt: teamPostsTable.createdAt,
      pinned: teamPostsTable.pinned,
    })
    .from(teamPostsTable)
    .leftJoin(usersTable, eq(teamPostsTable.authorId, usersTable.id))
    .where(eq(teamPostsTable.id, row.id));

  return mapTeamPost(created);
}

export async function toggleTeamPostPin(id: number): Promise<TeamPost> {
  const [changed] = await db
    .update(teamPostsTable)
    .set({ pinned: sql<boolean>`NOT ${teamPostsTable.pinned}` })
    .where(eq(teamPostsTable.id, id))
    .returning({ id: teamPostsTable.id });
  if (!changed) throw new Error("Post not found");

  const [updated] = await db
    .select({
      id: teamPostsTable.id,
      authorId: teamPostsTable.authorId,
      authorName: usersTable.displayName,
      body: teamPostsTable.body,
      createdAt: teamPostsTable.createdAt,
      pinned: teamPostsTable.pinned,
    })
    .from(teamPostsTable)
    .leftJoin(usersTable, eq(teamPostsTable.authorId, usersTable.id))
    .where(eq(teamPostsTable.id, id));

  return mapTeamPost(updated);
}

export async function deleteOwnTeamPost(id: number, authorId: number): Promise<void> {
  const [post] = await db
    .select({ authorId: teamPostsTable.authorId })
    .from(teamPostsTable)
    .where(eq(teamPostsTable.id, id));

  if (!post) throw new Error("Post not found");
  if (post.authorId !== authorId) throw new Error("You can only delete your own posts");

  const [deleted] = await db
    .delete(teamPostsTable)
    .where(and(eq(teamPostsTable.id, id), eq(teamPostsTable.authorId, authorId)))
    .returning({ id: teamPostsTable.id });
  if (!deleted) throw new Error("Post not found");
}