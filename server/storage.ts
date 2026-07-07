import type {
  User, InsertUser,
  Document, Chunk, Citation,
  ChatSession, InsertChatSession,
  ChatMessage, InsertChatMessage,
} from "@shared/schema";

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class InMemoryStorage implements IStorage {
  private users: User[] = [];
  private documents: Document[] = [];
  private chunks: Chunk[] = [];
  private citations: Citation[] = [];
  private chatSessions: ChatSession[] = [];
  private chatMessages: ChatMessage[] = [];

  private userIdSeq = 1;
  private docIdSeq = 1;
  private chunkIdSeq = 1;
  private citationIdSeq = 1;
  private sessionIdSeq = 1;
  private messageIdSeq = 1;

  async getUser(id: number): Promise<User | undefined> {
    return this.users.find(u => u.id === id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.users.find(u => u.email === email);
  }

  async createUser(user: InsertUser): Promise<User> {
    const created: User = { ...user, id: this.userIdSeq++ };
    this.users.push(created);
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return [...this.users];
  }

  async createDocument(doc: Omit<Document, "id">): Promise<Document> {
    const created: Document = { ...doc, id: this.docIdSeq++ };
    this.documents.push(created);
    return created;
  }

  async getDocument(id: number): Promise<Document | undefined> {
    return this.documents.find(d => d.id === id);
  }

  async getAllDocuments(): Promise<Document[]> {
    return [...this.documents];
  }

  async updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined> {
    const idx = this.documents.findIndex(d => d.id === id);
    if (idx === -1) return undefined;
    this.documents[idx] = { ...this.documents[idx], ...updates };
    return this.documents[idx];
  }

  async deleteDocument(id: number): Promise<void> {
    this.documents = this.documents.filter(d => d.id !== id);
  }

  async getChunksByDocumentId(documentId: number): Promise<Chunk[]> {
    return this.chunks.filter(c => c.documentId === documentId);
  }

  async deleteChunksByDocumentId(documentId: number): Promise<void> {
    this.chunks = this.chunks.filter(c => c.documentId !== documentId);
  }

  async insertChunks(chunkData: Omit<Chunk, "id">[]): Promise<void> {
    for (const c of chunkData) {
      this.chunks.push({ ...c, id: this.chunkIdSeq++ });
    }
  }

  async searchSimilarChunks(
    embedding: number[],
    documentIds: number[],
    limit: number
  ): Promise<(Chunk & { similarity: number })[]> {
    const candidates = this.chunks.filter(
      c => documentIds.includes(c.documentId) && c.embedding != null
    );
    const scored = candidates.map(c => ({
      ...c,
      similarity: cosineSimilarity(embedding, c.embedding!),
    }));
    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  async createCitation(citation: Omit<Citation, "id">): Promise<Citation> {
    const created: Citation = { ...citation, id: this.citationIdSeq++ };
    this.citations.push(created);
    return created;
  }

  async getCitationsByUserId(userId: number): Promise<(Citation & { documentTitle: string })[]> {
    return this.citations
      .filter(c => c.userId === userId)
      .map(c => ({
        ...c,
        documentTitle: this.documents.find(d => d.id === c.documentId)?.title ?? "Unknown",
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async deleteCitationsByDocumentId(documentId: number): Promise<void> {
    this.citations = this.citations.filter(c => c.documentId !== documentId);
  }

  async getAccessibleDocumentIds(user: User): Promise<number[]> {
    const userDomain = user.email.split("@")[1];
    return this.documents
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
    const now = new Date().toISOString();
    const created: ChatSession = {
      ...session,
      id: this.sessionIdSeq++,
      createdAt: now,
      updatedAt: now,
    };
    this.chatSessions.push(created);
    return created;
  }

  async getChatSessionsByUserId(userId: number): Promise<ChatSession[]> {
    return this.chatSessions
      .filter(s => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getChatSession(id: number): Promise<ChatSession | undefined> {
    return this.chatSessions.find(s => s.id === id);
  }

  async deleteChatSession(id: number): Promise<void> {
    this.chatSessions = this.chatSessions.filter(s => s.id !== id);
    this.chatMessages = this.chatMessages.filter(m => m.sessionId !== id);
  }

  async updateChatSessionTitle(id: number, title: string): Promise<void> {
    const idx = this.chatSessions.findIndex(s => s.id === id);
    if (idx !== -1) this.chatSessions[idx] = { ...this.chatSessions[idx], title };
  }

  async updateChatSessionTimestamp(id: number): Promise<void> {
    const idx = this.chatSessions.findIndex(s => s.id === id);
    if (idx !== -1)
      this.chatSessions[idx] = { ...this.chatSessions[idx], updatedAt: new Date().toISOString() };
  }

  async addChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const created: ChatMessage = {
      ...message,
      id: this.messageIdSeq++,
      createdAt: new Date().toISOString(),
    };
    this.chatMessages.push(created);
    return created;
  }

  async getChatMessagesBySessionId(sessionId: number): Promise<ChatMessage[]> {
    return this.chatMessages
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export const storage = new InMemoryStorage();
