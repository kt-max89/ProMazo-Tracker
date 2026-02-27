import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, vector, index, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  displayName: text("display_name").notNull(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  adminOnly: boolean("admin_only").notNull().default(false),
  allowedUsers: text("allowed_users").array().default(sql`'{}'::text[]`),
  allowedDomain: text("allowed_domain"),
  chunkCount: integer("chunk_count").notNull().default(0),
  uploadedBy: integer("uploaded_by").notNull(),
  uploadedAt: text("uploaded_at").notNull().default(sql`now()::text`),
});

export const chunks = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  chunkHash: text("chunk_hash").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
}, (table) => [
  index("chunks_document_id_idx").on(table.documentId),
]);

export const citations = pgTable("citations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  documentId: integer("document_id").notNull().references(() => documents.id),
  chunkId: integer("chunk_id").notNull().references(() => chunks.id),
  query: text("query").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
  updatedAt: text("updated_at").notNull().default(sql`now()::text`),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull().default(sql`now()::text`),
});

export const insertChatSessionSchema = createInsertSchema(chatSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().min(1, "Display name is required"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const insertDocumentSchema = createInsertSchema(documents).omit({
  id: true,
  chunkCount: true,
  uploadedBy: true,
  uploadedAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Citation = typeof citations.$inferSelect;
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = z.infer<typeof insertChatSessionSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
