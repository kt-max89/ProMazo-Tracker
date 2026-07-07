/**
 * Drizzle ORM table definitions for all entities.
 * Imported by server/db.ts, server/storage.ts, server/taskService.ts,
 * server/projectService.ts. NOT imported by the client.
 */
import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// ─── Users ───────────────────────────────────────────────────────────────────

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"),
  displayName: text("display_name").notNull(),
});

// ─── Documents & chunks ──────────────────────────────────────────────────────

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  adminOnly: boolean("admin_only").notNull().default(false),
  allowedUsers: jsonb("allowed_users").$type<string[]>().notNull().default([]),
  allowedDomain: text("allowed_domain"),
  chunkCount: integer("chunk_count").notNull().default(0),
  uploadedBy: integer("uploaded_by")
    .notNull()
    .references(() => usersTable.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chunksTable = pgTable("chunks", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id")
    .notNull()
    .references(() => documentsTable.id),
  chunkIndex: integer("chunk_index").notNull(),
  chunkText: text("chunk_text").notNull(),
  chunkHash: text("chunk_hash").notNull(),
  // Stored as JSONB (float array); JS-side cosine similarity — no pgvector needed.
  embedding: jsonb("embedding").$type<number[] | null>(),
});

// ─── Citations ───────────────────────────────────────────────────────────────

export const citationsTable = pgTable("citations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  documentId: integer("document_id")
    .notNull()
    .references(() => documentsTable.id),
  chunkId: integer("chunk_id")
    .notNull()
    .references(() => chunksTable.id),
  query: text("query").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Chat sessions & messages ─────────────────────────────────────────────────

export const chatSessionsTable = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  title: text("title").notNull().default("New Chat"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => chatSessionsTable.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Projects ─────────────────────────────────────────────────────────────────

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  timeline: text("timeline"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: integer("created_by").references(() => usersTable.id),
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("not_started"),
  blockedReason: text("blocked_reason"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: integer("created_by").references(() => usersTable.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  assignedTo: integer("assigned_to").references(() => usersTable.id),
  projectId: integer("project_id").references(() => projectsTable.id),
});
