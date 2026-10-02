import { eq, desc, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  usersTable,
  documentsTable,
  chunksTable,
  citationsTable,
  chatSessionsTable,
  chatMessagesTable,
} from "./schema";
import type {
  User,
  InsertUser,
  Document,
  Chunk,
  Citation,
  ChatSession,
  InsertChatSession,
  ChatMessage,
  InsertChatMessage,
} from "@shared/schema";

// ─── IStorage interface ───────────────────────────────────────────────────────

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;

  createDocument(doc: Omit<Document, "id">): Promise<Document>;
  getDocument(id: number): Promise<Document | undefined>;
  getAllDocuments(): Promise<Document[]>;
  updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined>;
  deleteDocument(id: number): Promise<void>;

  getChunksByDocumentId(documentId: number): Promise<Chunk[]>;
  deleteChunksByDocumentId(documentId: number): Promise<void>;
  insertChunks(chunkData: Omit<Chunk, "id">[]): Promise<void>;
  searchSimilarChunks(embedding: number[], documentIds: number[], limit: number): Promise<(Chunk & { similarity: number })[]>;

  createCitation(citation: Omit<Citation, "id">): Promise<Citation>;
  getCitationsByUserId(userId: number): Promise<(Citation & { documentTitle: string })[]>;
  deleteCitationsByDocumentId(documentId: number): Promise<void>;

  getAccessibleDocumentIds(user: User): Promise<number[]>;

  createChatSession(session: InsertChatSession): Promise<ChatSession>;
  getChatSessionsByUserId(userId: number): Promise<ChatSession[]>;
  getChatSession(id: number): Promise<ChatSession | undefined>;
  deleteChatSession(id: number): Promise<void>;
  updateChatSessionTitle(id: number, title: string): Promise<void>;
  updateChatSessionTimestamp(id: number): Promise<void>;

  addChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesBySessionId(sessionId: number): Promise<ChatMessage[]>;
}

// ─── Row → domain-type mappers ────────────────────────────────────────────────
// Drizzle returns Date objects for timestamp columns; the domain types use ISO strings.

function mapUser(row: typeof usersTable.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role as User["role"],
    displayName: row.displayName,
    teamId: row.teamId,
  };
}

function mapDocument(row: typeof documentsTable.$inferSelect): Document {
  return {
    id: row.id,
    title: row.title,
    filename: row.filename,
    adminOnly: row.adminOnly,
    allowedUsers: (row.allowedUsers as string[]) ?? [],
    allowedDomain: row.allowedDomain,
    chunkCount: row.chunkCount,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt instanceof Date
      ? row.uploadedAt.toISOString()
      : String(row.uploadedAt),
  };
}

function mapChunk(row: typeof chunksTable.$inferSelect): Chunk {
  return {
    id: row.id,
    documentId: row.documentId,
    chunkIndex: row.chunkIndex,
    chunkText: row.chunkText,
    chunkHash: row.chunkHash,
    embedding: row.embedding as number[] | null,
  };
}

function mapCitation(row: typeof citationsTable.$inferSelect): Citation {
  return {
    id: row.id,
    userId: row.userId,
    documentId: row.documentId,
    chunkId: row.chunkId,
    query: row.query,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt),
  };
}

function mapChatSession(row: typeof chatSessionsTable.$inferSelect): ChatSession {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : String(row.updatedAt),
  };
}

function mapChatMessage(row: typeof chatMessagesTable.$inferSelect): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role as ChatMessage["role"],
    content: row.content,
    createdAt: row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt),
  };
}

// ─── Cosine similarity (JS-side, no pgvector required) ───────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// ─── DatabaseStorage ──────────────────────────────────────────────────────────

export class DatabaseStorage implements IStorage {

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
    return row ? mapUser(row) : undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    return row ? mapUser(row) : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [row] = await db
      .insert(usersTable)
      .values({
        email: user.email,
        passwordHash: user.passwordHash,
        role: user.role,
        displayName: user.displayName,
      })
      .returning();
    return mapUser(row);
  }

  async getAllUsers(): Promise<User[]> {
    const rows = await db.select().from(usersTable);
    return rows.map(mapUser);
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  async createDocument(doc: Omit<Document, "id">): Promise<Document> {
    const [row] = await db
      .insert(documentsTable)
      .values({
        title: doc.title,
        filename: doc.filename,
        adminOnly: doc.adminOnly,
        allowedUsers: doc.allowedUsers,
        allowedDomain: doc.allowedDomain,
        chunkCount: doc.chunkCount,
        uploadedBy: doc.uploadedBy,
      })
      .returning();
    return mapDocument(row);
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [row] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    return row ? mapDocument(row) : undefined;
  }

  async getAllDocuments(): Promise<Document[]> {
    const rows = await db.select().from(documentsTable);
    return rows.map(mapDocument);
  }

  async updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined> {
    const set: Record<string, unknown> = {};
    if (updates.title !== undefined) set.title = updates.title;
    if (updates.filename !== undefined) set.filename = updates.filename;
    if (updates.adminOnly !== undefined) set.adminOnly = updates.adminOnly;
    if (updates.allowedUsers !== undefined) set.allowedUsers = updates.allowedUsers;
    if (updates.allowedDomain !== undefined) set.allowedDomain = updates.allowedDomain;
    if (updates.chunkCount !== undefined) set.chunkCount = updates.chunkCount;

    if (Object.keys(set).length === 0) {
      return this.getDocument(id);
    }

    const [row] = await db
      .update(documentsTable)
      .set(set)
      .where(eq(documentsTable.id, id))
      .returning();
    return row ? mapDocument(row) : undefined;
  }

  async deleteDocument(id: number): Promise<void> {
    // Delete chunks first so the FK constraint on chunks.document_id doesn't block
    // the document delete.  Citations are already deleted by the route before this
    // method is called, so citations.chunk_id is already clear.
    await db.delete(chunksTable).where(eq(chunksTable.documentId, id));
    await db.delete(documentsTable).where(eq(documentsTable.id, id));
  }

  // ── Chunks ─────────────────────────────────────────────────────────────────

  async getChunksByDocumentId(documentId: number): Promise<Chunk[]> {
    const rows = await db
      .select()
      .from(chunksTable)
      .where(eq(chunksTable.documentId, documentId));
    return rows.map(mapChunk);
  }

  async deleteChunksByDocumentId(documentId: number): Promise<void> {
    await db.delete(chunksTable).where(eq(chunksTable.documentId, documentId));
  }

  async insertChunks(chunkData: Omit<Chunk, "id">[]): Promise<void> {
    if (chunkData.length === 0) return;
    const BATCH = 200;
    for (let i = 0; i < chunkData.length; i += BATCH) {
      const slice = chunkData.slice(i, i + BATCH);
      await db.insert(chunksTable).values(
        slice.map((c) => ({
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          chunkText: c.chunkText,
          chunkHash: c.chunkHash,
          embedding: c.embedding,
        }))
      );
    }
  }

  async searchSimilarChunks(
    embedding: number[],
    documentIds: number[],
    limit: number
  ): Promise<(Chunk & { similarity: number })[]> {
    if (documentIds.length === 0) return [];
    const rows = await db
      .select()
      .from(chunksTable)
      .where(inArray(chunksTable.documentId, documentIds));

    const candidates = rows.filter((r) => r.embedding != null);
    const scored = candidates.map((r) => ({
      ...mapChunk(r),
      similarity: cosineSimilarity(embedding, r.embedding as number[]),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.filter((r) => r.similarity >= 0.25).slice(0, limit);
  }

  // ── Citations ──────────────────────────────────────────────────────────────

  async createCitation(citation: Omit<Citation, "id">): Promise<Citation> {
    const [row] = await db
      .insert(citationsTable)
      .values({
        userId: citation.userId,
        documentId: citation.documentId,
        chunkId: citation.chunkId,
        query: citation.query,
      })
      .returning();
    return mapCitation(row);
  }

  async getCitationsByUserId(userId: number): Promise<(Citation & { documentTitle: string })[]> {
    const rows = await db
      .select({
        id: citationsTable.id,
        userId: citationsTable.userId,
        documentId: citationsTable.documentId,
        chunkId: citationsTable.chunkId,
        query: citationsTable.query,
        createdAt: citationsTable.createdAt,
        documentTitle: documentsTable.title,
      })
      .from(citationsTable)
      .innerJoin(documentsTable, eq(citationsTable.documentId, documentsTable.id))
      .where(eq(citationsTable.userId, userId))
      .orderBy(desc(citationsTable.createdAt));

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      documentId: r.documentId,
      chunkId: r.chunkId,
      query: r.query,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      documentTitle: r.documentTitle,
    }));
  }

  async deleteCitationsByDocumentId(documentId: number): Promise<void> {
    await db.delete(citationsTable).where(eq(citationsTable.documentId, documentId));
  }

  // ── Document access control ────────────────────────────────────────────────

  async getAccessibleDocumentIds(user: User): Promise<number[]> {
    const docs = await db.select().from(documentsTable);
    const userDomain = user.email.split("@")[1];
    return docs
      .filter((doc) => {
        if (doc.adminOnly) return user.role === "admin";
        const allowed = (doc.allowedUsers as string[]) ?? [];
        if (allowed.length > 0) return allowed.includes(user.email);
        if (doc.allowedDomain) return userDomain === doc.allowedDomain;
        return true;
      })
      .map((doc) => doc.id);
  }

  // ── Chat sessions ──────────────────────────────────────────────────────────

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [row] = await db
      .insert(chatSessionsTable)
      .values({ userId: session.userId, title: session.title })
      .returning();
    return mapChatSession(row);
  }

  async getChatSessionsByUserId(userId: number): Promise<ChatSession[]> {
    const rows = await db
      .select()
      .from(chatSessionsTable)
      .where(eq(chatSessionsTable.userId, userId))
      .orderBy(desc(chatSessionsTable.updatedAt));
    return rows.map(mapChatSession);
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    const [row] = await db
      .select()
      .from(chatSessionsTable)
      .where(eq(chatSessionsTable.id, id));
    return row ? mapChatSession(row) : undefined;
  }

  async deleteChatSession(id: number): Promise<void> {
    // Explicitly delete messages first (pre-existing chat_messages table may not
    // have ON DELETE CASCADE on session_id — belt-and-suspenders approach).
    await db.delete(chatMessagesTable).where(eq(chatMessagesTable.sessionId, id));
    await db.delete(chatSessionsTable).where(eq(chatSessionsTable.id, id));
  }

  async updateChatSessionTitle(id: number, title: string): Promise<void> {
    await db
      .update(chatSessionsTable)
      .set({ title })
      .where(eq(chatSessionsTable.id, id));
  }

  async updateChatSessionTimestamp(id: number): Promise<void> {
    await db
      .update(chatSessionsTable)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessionsTable.id, id));
  }

  // ── Chat messages ──────────────────────────────────────────────────────────

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [row] = await db
      .insert(chatMessagesTable)
      .values({
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
      })
      .returning();
    return mapChatMessage(row);
  }

  async getChatMessagesBySessionId(sessionId: number): Promise<ChatMessage[]> {
    const rows = await db
      .select()
      .from(chatMessagesTable)
      .where(eq(chatMessagesTable.sessionId, sessionId))
      .orderBy(chatMessagesTable.createdAt);
    return rows.map(mapChatMessage);
  }
}

export const storage = new DatabaseStorage();
