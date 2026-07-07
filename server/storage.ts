import type {
  User, InsertUser,
  Document, Chunk, Citation,
  ChatSession, InsertChatSession,
  ChatMessage, InsertChatMessage,
} from "@shared/schema";

// ─── Cosine similarity helper ─────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Storage interface ────────────────────────────────────────────────────────

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

// ─── In-memory implementation ─────────────────────────────────────────────────

class MemoryStorage implements IStorage {
  private users = new Map<number, User>();
  private documents = new Map<number, Document>();
  private chunks = new Map<number, Chunk>();
  private citations = new Map<number, Citation>();
  private chatSessions = new Map<number, ChatSession>();
  private chatMessages = new Map<number, ChatMessage>();

  private nextId = {
    users: 1, documents: 1, chunks: 1,
    citations: 1, chatSessions: 1, chatMessages: 1,
  };

  // ── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = this.nextId.users++;
    const created: User = { ...user, id };
    this.users.set(id, created);
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  // ── Documents ──────────────────────────────────────────────────────────────

  async createDocument(doc: Omit<Document, "id">): Promise<Document> {
    const id = this.nextId.documents++;
    const created: Document = { ...doc, id };
    this.documents.set(id, created);
    return created;
  }

  async getDocument(id: number): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async getAllDocuments(): Promise<Document[]> {
    return Array.from(this.documents.values());
  }

  async updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined> {
    const doc = this.documents.get(id);
    if (!doc) return undefined;
    const updated = { ...doc, ...updates };
    this.documents.set(id, updated);
    return updated;
  }

  async deleteDocument(id: number): Promise<void> {
    this.documents.delete(id);
  }

  // ── Chunks ─────────────────────────────────────────────────────────────────

  async getChunksByDocumentId(documentId: number): Promise<Chunk[]> {
    return Array.from(this.chunks.values()).filter(c => c.documentId === documentId);
  }

  async deleteChunksByDocumentId(documentId: number): Promise<void> {
    for (const [id, chunk] of Array.from(this.chunks.entries())) {
      if (chunk.documentId === documentId) this.chunks.delete(id);
    }
  }

  async insertChunks(chunkData: Omit<Chunk, "id">[]): Promise<void> {
    for (const data of chunkData) {
      const id = this.nextId.chunks++;
      this.chunks.set(id, { ...data, id });
    }
  }

  async searchSimilarChunks(
    embedding: number[],
    documentIds: number[],
    limit: number,
  ): Promise<(Chunk & { similarity: number })[]> {
    const docSet = new Set(documentIds);
    const results: (Chunk & { similarity: number })[] = [];

    for (const chunk of Array.from(this.chunks.values())) {
      if (!docSet.has(chunk.documentId)) continue;
      if (!chunk.embedding) continue;
      const similarity = cosineSimilarity(embedding, chunk.embedding);
      results.push({ ...chunk, similarity });
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, limit);
  }

  // ── Citations ──────────────────────────────────────────────────────────────

  async createCitation(citation: Omit<Citation, "id">): Promise<Citation> {
    const id = this.nextId.citations++;
    const created: Citation = { ...citation, id };
    this.citations.set(id, created);
    return created;
  }

  async getCitationsByUserId(userId: number): Promise<(Citation & { documentTitle: string })[]> {
    return Array.from(this.citations.values())
      .filter(c => c.userId === userId)
      .map(c => ({
        ...c,
        documentTitle: this.documents.get(c.documentId)?.title ?? "Unknown",
      }));
  }

  async deleteCitationsByDocumentId(documentId: number): Promise<void> {
    for (const [id, c] of Array.from(this.citations.entries())) {
      if (c.documentId === documentId) this.citations.delete(id);
    }
  }

  // ── Accessible document IDs ────────────────────────────────────────────────
  // Precedence (most restrictive first):
  //   1. adminOnly → skip
  //   2. allowedUsers non-empty → explicit user match required
  //   3. allowedDomain set → domain match
  //   4. both empty → public (any authenticated user)

  async getAccessibleDocumentIds(user: User): Promise<number[]> {
    if (user.role === "admin") {
      return Array.from(this.documents.keys());
    }
    const ids: number[] = [];
    for (const doc of Array.from(this.documents.values())) {
      if (doc.adminOnly) continue;
      if (doc.allowedUsers.length > 0) {
        if (doc.allowedUsers.includes(user.email)) ids.push(doc.id);
        continue;
      }
      if (doc.allowedDomain) {
        if (user.email.endsWith(`@${doc.allowedDomain}`)) ids.push(doc.id);
        continue;
      }
      // Public document — accessible to all authenticated users
      ids.push(doc.id);
    }
    return ids;
  }

  // ── Chat sessions ──────────────────────────────────────────────────────────

  async createChatSession(session: InsertChatSession): Promise<ChatSession> {
    const id = this.nextId.chatSessions++;
    const now = new Date().toISOString();
    const created: ChatSession = { ...session, id, createdAt: now, updatedAt: now };
    this.chatSessions.set(id, created);
    return created;
  }

  async getChatSessionsByUserId(userId: number): Promise<ChatSession[]> {
    return Array.from(this.chatSessions.values())
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    return this.chatSessions.get(id);
  }

  async deleteChatSession(id: number): Promise<void> {
    this.chatSessions.delete(id);
    for (const [mid, msg] of Array.from(this.chatMessages.entries())) {
      if (msg.sessionId === id) this.chatMessages.delete(mid);
    }
  }

  async updateChatSessionTitle(id: number, title: string): Promise<void> {
    const session = this.chatSessions.get(id);
    if (session) this.chatSessions.set(id, { ...session, title });
  }

  async updateChatSessionTimestamp(id: number): Promise<void> {
    const session = this.chatSessions.get(id);
    if (session) this.chatSessions.set(id, { ...session, updatedAt: new Date().toISOString() });
  }

  // ── Chat messages ──────────────────────────────────────────────────────────

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const id = this.nextId.chatMessages++;
    const created: ChatMessage = { ...message, id, createdAt: new Date().toISOString() };
    this.chatMessages.set(id, created);
    return created;
  }

  async getChatMessagesBySessionId(sessionId: number): Promise<ChatMessage[]> {
    return Array.from(this.chatMessages.values())
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export const storage = new MemoryStorage();
