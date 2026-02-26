import { eq, inArray, sql, and } from "drizzle-orm";
import { db } from "./db";
import { users, documents, chunks, citations, type User, type InsertUser, type Document, type Chunk, type Citation } from "@shared/schema";

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
    const result = await db.execute(sql`
      SELECT id, document_id, chunk_index, chunk_text, chunk_hash, embedding,
             1 - (embedding <=> ${embeddingStr}::vector) as similarity
      FROM chunks
      WHERE document_id = ANY(${documentIds})
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
}

export const storage = new DatabaseStorage();
