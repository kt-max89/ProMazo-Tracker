import { eq, inArray, sql, and, desc } from "drizzle-orm";
import { db } from "./db";
import { users, documents, chunks, citations, chatSessions, chatMessages, type User, type InsertUser, type Document, type Chunk, type Citation, type ChatSession, type InsertChatSession, type ChatMessage, type InsertChatMessage } from "@shared/schema";

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

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async createDocument(doc: Omit<Document, "id">): Promise<Document> {
    const [created] = await db.insert(documents).values(doc).returning();
    return created;
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    return doc;
  }

  async getAllDocuments(): Promise<Document[]> {
    return db.select().from(documents);
  }

  async updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined> {
    const [updated] = await db.update(documents).set(updates).where(eq(documents.id, id)).returning();
    return updated;
  }

  async deleteDocument(id: number): Promise<void> {
    await db.delete(documents).where(eq(documents.id, id));
  }

  async getChunksByDocumentId(documentId: number): Promise<Chunk[]> {
    return db.select().from(chunks).where(eq(chunks.documentId, documentId));
  }

  async deleteChunksByDocumentId(documentId: number): Promise<void> {
    await db.delete(chunks).where(eq(chunks.documentId, documentId));
  }

  async insertChunks(chunkData: Omit<Chunk, "id">[]): Promise<void> {
    if (chunkData.length === 0) return;
    await db.insert(chunks).values(chunkData);
  }

  async searchSimilarChunks(embedding: number[], documentIds: number[], limit: number): Promise<(Chunk & { similarity: number })[]> {
    if (documentIds.length === 0) return [];
    
    const embeddingStr = `[${embedding.join(",")}]`;
    const docIdsArray = `{${documentIds.join(",")}}`;
    const result = await db.execute(sql`
      SELECT id, document_id, chunk_index, chunk_text, chunk_hash, embedding,
             1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM chunks
      WHERE document_id = ANY(${docIdsArray}::int[])
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);
    
    return (result.rows as any[]).map(row => ({
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      chunkText: row.chunk_text,
      chunkHash: row.chunk_hash,
      embedding: row.embedding,
      similarity: parseFloat(row.similarity),
    }));
  }

  async deleteCitationsByDocumentId(documentId: number): Promise<void> {
    await db.delete(citations).where(eq(citations.documentId, documentId));
  }

  async createCitation(citation: Omit<Citation, "id">): Promise<Citation> {
    const [created] = await db.insert(citations).values(citation).returning();
    return created;
  }

  async getCitationsByUserId(userId: number): Promise<(Citation & { documentTitle: string })[]> {
    const result = await db
      .select({
        id: citations.id,
        userId: citations.userId,
        documentId: citations.documentId,
        chunkId: citations.chunkId,
        query: citations.query,
        createdAt: citations.createdAt,
        documentTitle: documents.title,
      })
      .from(citations)
      .innerJoin(documents, eq(citations.documentId, documents.id))
      .where(eq(citations.userId, userId))
      .orderBy(sql`${citations.createdAt} DESC`);
    return result;
  }

  async getAccessibleDocumentIds(user: User): Promise<number[]> {
    const allDocs = await this.getAllDocuments();
    const userDomain = user.email.split("@")[1];

    return allDocs
      .filter(doc => {
        if (doc.adminOnly) return user.role === "admin";
        if (doc.allowedUsers && doc.allowedUsers.length > 0) {
          return doc.allowedUsers.includes(user.email);
        }
        if (doc.allowedDomain) {
          return userDomain === doc.allowedDomain;
        }
        return true;
      })
      .map(doc => doc.id);
  }

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const [created] = await db.insert(chatSessions).values({
      ...session,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).returning();
    return created;
  }

  async getChatSessionsByUserId(userId: number): Promise<ChatSession[]> {
    return db.select().from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt));
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, id));
    return session;
  }

  async deleteChatSession(id: number): Promise<void> {
    await db.delete(chatSessions).where(eq(chatSessions.id, id));
  }

  async updateChatSessionTitle(id: number, title: string): Promise<void> {
    await db.update(chatSessions).set({ title }).where(eq(chatSessions.id, id));
  }

  async updateChatSessionTimestamp(id: number): Promise<void> {
    await db.update(chatSessions).set({ updatedAt: new Date().toISOString() }).where(eq(chatSessions.id, id));
  }

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const [created] = await db.insert(chatMessages).values({
      ...message,
      createdAt: new Date().toISOString(),
    }).returning();
    return created;
  }

  async getChatMessagesBySessionId(sessionId: number): Promise<ChatMessage[]> {
    return db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
  }
}

export const storage = new DatabaseStorage();
