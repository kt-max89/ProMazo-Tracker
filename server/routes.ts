import type { Express } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import bcrypt from "bcrypt";
import multer from "multer";
import { storage } from "./storage";
import { setupAuth, requireAuth, requireAdmin } from "./auth";
import { registerSchema, loginSchema, insertTaskSchema, updateTaskSchema, insertProjectSchema, updateProjectSchema } from "@shared/schema";
import { listTasks, createTask, updateTask, archiveTask, restoreTask } from "./taskService";
import { listProjects, getProject, createProject, updateProject } from "./projectService";
import { chunkText, hashChunk, getEmbedding, getEmbeddings } from "./openai";
import { handleChatMessage } from "./chatOrchestrator";
import { validateProposal } from "./proposalSchema";
import { listDriveFiles, listDriveFolders, listFilesInFolder, getFilePermissions, getDriveFileContent } from "./google-drive";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupAuth(app);

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const { email, password, displayName } = parsed.data;
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        return res.status(409).json({ message: "Email already registered" });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const allUsers = await storage.getAllUsers();
      const role = allUsers.length === 0 ? "admin" : "user";
      const user = await storage.createUser({ email, passwordHash, displayName, role });
      req.login(user, (err) => {
        if (err) return res.status(500).json({ message: "Login failed after registration" });
        const { passwordHash: _, ...safeUser } = user;
        return res.json(safeUser);
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/auth/login", (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (err) => {
        if (err) return next(err);
        const { passwordHash: _, ...safeUser } = user;
        return res.json(safeUser);
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
    const { passwordHash: _, ...safeUser } = req.user!;
    res.json(safeUser);
  });

  // Document management (admin only)
  app.get("/api/documents", requireAuth, async (req, res) => {
    try {
      const docs = await storage.getAllDocuments();
      if (req.user!.role === "admin") {
        return res.json(docs);
      }
      const accessibleIds = await storage.getAccessibleDocumentIds(req.user! as any);
      return res.json(docs.filter(d => accessibleIds.includes(d.id)));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/documents", requireAdmin, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const title = req.body.title || req.file.originalname;
      const adminOnly = req.body.adminOnly === "true";
      const allowedUsers = req.body.allowedUsers ? JSON.parse(req.body.allowedUsers) : [];
      const allowedDomain = req.body.allowedDomain || null;

      let text = "";
      if (req.file.mimetype === "application/pdf") {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
        await parser.load();
        const pdfResult = await parser.getText();
        text = pdfResult.text;
      } else {
        text = req.file.buffer.toString("utf-8");
      }

      if (!text || text.trim().length < 50) {
        return res.status(400).json({ 
          message: "Extracted text is too short or empty. The file may be image-based or corrupted." 
        });
      }

      const textChunks = chunkText(text);
      const hashes = textChunks.map(hashChunk);
      const embeddings = await getEmbeddings(textChunks);

      const doc = await storage.createDocument({
        title,
        filename: req.file.originalname,
        adminOnly,
        allowedUsers,
        allowedDomain,
        chunkCount: textChunks.length,
        uploadedBy: req.user!.id,
        uploadedAt: new Date().toISOString(),
      });

      const chunkData = textChunks.map((ct, i) => ({
        documentId: doc.id,
        chunkIndex: i,
        chunkText: ct,
        chunkHash: hashes[i],
        embedding: embeddings[i],
      }));

      await storage.insertChunks(chunkData);
      return res.json(doc);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/documents/:id/reindex", requireAdmin, async (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const doc = await storage.getDocument(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      const existingChunks = await storage.getChunksByDocumentId(docId);
      const existingHashes = new Map(existingChunks.map(c => [c.chunkHash, c]));

      const chunksToEmbed: { index: number; text: string }[] = [];
      const keptChunks: typeof existingChunks = [];

      for (const chunk of existingChunks) {
        const newHash = hashChunk(chunk.chunkText);
        if (newHash === chunk.chunkHash && chunk.embedding) {
          keptChunks.push(chunk);
        } else {
          chunksToEmbed.push({ index: chunk.chunkIndex, text: chunk.chunkText });
        }
      }

      if (chunksToEmbed.length === 0) {
        return res.json({ message: "No changes detected, skipping re-embedding", doc });
      }

      const embeddings = await getEmbeddings(chunksToEmbed.map(c => c.text));
      await storage.deleteChunksByDocumentId(docId);

      const allChunks = [
        ...keptChunks.map(c => ({
          documentId: c.documentId,
          chunkIndex: c.chunkIndex,
          chunkText: c.chunkText,
          chunkHash: c.chunkHash,
          embedding: c.embedding,
        })),
        ...chunksToEmbed.map((c, i) => ({
          documentId: docId,
          chunkIndex: c.index,
          chunkText: c.text,
          chunkHash: hashChunk(c.text),
          embedding: embeddings[i],
        })),
      ];

      await storage.insertChunks(allChunks);
      await storage.updateDocument(docId, { chunkCount: allChunks.length });
      return res.json({ message: `Re-indexed ${chunksToEmbed.length} chunks`, doc });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/documents/:id", requireAdmin, async (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      const { title, adminOnly, allowedUsers, allowedDomain } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (adminOnly !== undefined) updates.adminOnly = adminOnly;
      if (allowedUsers !== undefined) updates.allowedUsers = allowedUsers;
      if (allowedDomain !== undefined) updates.allowedDomain = allowedDomain;
      
      const doc = await storage.updateDocument(docId, updates);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      return res.json(doc);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/documents/:id", requireAdmin, async (req, res) => {
    try {
      const docId = parseInt(req.params.id);
      await storage.deleteCitationsByDocumentId(docId);
      await storage.deleteDocument(docId);
      return res.json({ message: "Deleted" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Google Drive integration routes
  app.get("/api/drive/files", requireAdmin, async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      const pageToken = req.query.pageToken as string | undefined;
      const result = await listDriveFiles(query, pageToken);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/drive/import", requireAdmin, async (req, res) => {
    try {
      const { fileId, mimeType, adminOnly, allowedDomain, allowedUsers } = req.body;
      if (!fileId || !mimeType) {
        return res.status(400).json({ message: "fileId and mimeType are required" });
      }

      const { text, name } = await getDriveFileContent(fileId, mimeType);

      if (!text || text.trim().length < 50) {
        return res.status(400).json({
          message: "Extracted text is too short or empty. The file may be image-based or corrupted."
        });
      }

      const textChunks = chunkText(text);
      const hashes = textChunks.map(hashChunk);
      const embeddings = await getEmbeddings(textChunks);

      const doc = await storage.createDocument({
        title: name,
        filename: name,
        adminOnly: adminOnly || false,
        allowedUsers: allowedUsers || [],
        allowedDomain: allowedDomain || null,
        chunkCount: textChunks.length,
        uploadedBy: req.user!.id,
        uploadedAt: new Date().toISOString(),
      });

      const chunkData = textChunks.map((ct, i) => ({
        documentId: doc.id,
        chunkIndex: i,
        chunkText: ct,
        chunkHash: hashes[i],
        embedding: embeddings[i],
      }));

      await storage.insertChunks(chunkData);
      return res.json(doc);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/drive/folders", requireAdmin, async (req, res) => {
    try {
      const query = req.query.q as string | undefined;
      const pageToken = req.query.pageToken as string | undefined;
      const result = await listDriveFolders(query, pageToken);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/drive/import-folder", requireAdmin, async (req, res) => {
    try {
      const { folderId } = req.body;
      if (!folderId) {
        return res.status(400).json({ message: "folderId is required" });
      }

      const files = await listFilesInFolder(folderId);
      if (files.length === 0) {
        return res.status(400).json({ message: "No compatible files found in this folder" });
      }

      const results: { name: string; status: string; error?: string }[] = [];

      for (const file of files) {
        try {
          const { text, name } = await getDriveFileContent(file.id, file.mimeType);

          if (!text || text.trim().length < 50) {
            results.push({ name: file.name, status: "skipped", error: "Text too short or empty" });
            continue;
          }

          const perms = await getFilePermissions(file.id);

          const textChunks = chunkText(text);
          const hashes = textChunks.map(hashChunk);
          const embeddings = await getEmbeddings(textChunks);

          let docAdminOnly = false;
          let docAllowedUsers: string[] = [];
          let docAllowedDomain: string | null = null;

          if (perms.isPublic) {
            docAdminOnly = false;
            docAllowedUsers = [];
            docAllowedDomain = null;
          } else if (perms.domain) {
            docAllowedDomain = perms.domain;
            docAllowedUsers = perms.userEmails;
          } else if (perms.userEmails.length > 0) {
            docAllowedUsers = perms.userEmails;
          } else {
            docAdminOnly = true;
          }

          const doc = await storage.createDocument({
            title: name,
            filename: name,
            adminOnly: docAdminOnly,
            allowedUsers: docAllowedUsers,
            allowedDomain: docAllowedDomain,
            chunkCount: textChunks.length,
            uploadedBy: req.user!.id,
            uploadedAt: new Date().toISOString(),
          });

          const chunkData = textChunks.map((ct, i) => ({
            documentId: doc.id,
            chunkIndex: i,
            chunkText: ct,
            chunkHash: hashes[i],
            embedding: embeddings[i],
          }));

          await storage.insertChunks(chunkData);
          results.push({ name: file.name, status: "imported" });
        } catch (err: any) {
          results.push({ name: file.name, status: "failed", error: err.message });
        }
      }

      const imported = results.filter(r => r.status === "imported").length;
      const skipped = results.filter(r => r.status === "skipped").length;
      const failed = results.filter(r => r.status === "failed").length;

      return res.json({ imported, skipped, failed, total: files.length, results });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Chat / Q&A endpoint with streaming
  app.post("/api/chat", requireAuth, async (req, res) => {
    try {
      const { query, sessionId } = req.body;
      if (!query || typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ message: "Query is required" });
      }

      const user = req.user! as any;
      const message = query.trim();

      let activeSessionId = sessionId ? parseInt(sessionId) : null;
      if (activeSessionId) {
        const session = await storage.getChatSession(activeSessionId);
        if (!session || session.userId !== user.id) {
          activeSessionId = null;
        }
      }

      if (activeSessionId) {
        await storage.addChatMessage({ sessionId: activeSessionId, role: "user", content: message });
        await storage.updateChatSessionTimestamp(activeSessionId);
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      for await (const event of handleChatMessage({ message, user, storage, sessionId: activeSessionId })) {
        if (event.type === "route") {
          res.write(`data: ${JSON.stringify({ type: "route", data: event.data })}\n\n`);
        } else if (event.type === "citations") {
          const citationData = event.data.map((c) => ({
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            chunkId: c.chunkId,
            chunkText: c.chunkText.slice(0, 200),
            similarity: c.similarity,
          }));
          res.write(`data: ${JSON.stringify({ type: "citations", data: citationData })}\n\n`);
        } else if (event.type === "token") {
          res.write(`data: ${JSON.stringify({ type: "token", data: event.data })}\n\n`);
        } else if (event.type === "done") {
          res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
        } else if (event.type === "task_proposal") {
          res.write(`data: ${JSON.stringify({ type: "task_proposal", data: event.data })}\n\n`);
        } else if (event.type === "error") {
          res.write(`data: ${JSON.stringify({ type: "error", data: event.data })}\n\n`);
        }
      }
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({ message: err.message });
      }
      res.write(`data: ${JSON.stringify({ type: "error", data: err.message })}\n\n`);
      res.end();
    }
  });

  // Chat sessions
  app.get("/api/chat-sessions", requireAuth, async (req, res) => {
    try {
      const sessions = await storage.getChatSessionsByUserId(req.user!.id);
      return res.json(sessions);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/chat-sessions", requireAuth, async (req, res) => {
    try {
      const { title } = req.body;
      const session = await storage.createChatSession({
        userId: req.user!.id,
        title: title || "New Chat",
      });
      return res.json(session);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/chat-sessions/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const session = await storage.getChatSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      const messages = await storage.getChatMessagesBySessionId(sessionId);
      return res.json({ session, messages });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/chat-sessions/:id", requireAuth, async (req, res) => {
    try {
      const sessionId = parseInt(req.params.id);
      const session = await storage.getChatSession(sessionId);
      if (!session) return res.status(404).json({ message: "Session not found" });
      if (session.userId !== req.user!.id) return res.status(403).json({ message: "Access denied" });
      await storage.deleteChatSession(sessionId);
      return res.json({ message: "Deleted" });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Citation history
  app.get("/api/citations", requireAuth, async (req, res) => {
    try {
      const cits = await storage.getCitationsByUserId(req.user!.id);
      return res.json(cits);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Users list (for assignee dropdowns)
  app.get("/api/users", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      return res.json(allUsers.map(({ passwordHash: _, ...u }) => u));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Task proposal approval — re-validates server-side, creates tasks through taskService only
  app.post("/api/task-proposals/approve", requireAuth, async (req, res) => {
    try {
      const { tasks: rawTasks } = req.body;
      if (!Array.isArray(rawTasks)) {
        return res.status(400).json({ message: "tasks must be an array" });
      }
      const proposal = validateProposal({ type: "create_task", tasks: rawTasks });
      if (!proposal) {
        return res.status(400).json({ message: "No valid tasks in proposal after validation" });
      }

      const allUsers = await storage.getAllUsers();
      let created = 0;
      for (const draft of proposal.tasks) {
        let assignedTo: number | null = null;
        if (draft.assignedToName) {
          const found = allUsers.find(
            (u) => u.displayName.toLowerCase() === draft.assignedToName!.toLowerCase()
          );
          if (found) assignedTo = found.id;
        }
        await createTask({
          title: draft.title,
          description: draft.description ?? null,
          status: "not_started",
          createdBy: req.user!.id,
          assignedTo,
        });
        created++;
      }
      return res.json({ created });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Project routes
  app.get("/api/projects", requireAuth, async (req, res) => {
    try {
      return res.json(await listProjects());
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    try {
      const parsed = insertProjectSchema.safeParse({ ...req.body, createdBy: req.user!.id });
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
      return res.json(await createProject(parsed.data));
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/projects/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project id" });
      const parsed = updateProjectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.errors[0].message });
      return res.json(await updateProject(id, parsed.data));
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/projects/:id/tasks", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid project id" });
      const all = await listTasks({ archived: false });
      return res.json(all.filter(t => t.projectId === id));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // Task routes
  app.get("/api/tasks", requireAuth, async (req, res) => {
    try {
      const taskList = await listTasks({ archived: false });
      return res.json(taskList);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/tasks/archived", requireAuth, async (req, res) => {
    try {
      const taskList = await listTasks({ archived: true });
      return res.json(taskList);
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/tasks", requireAuth, async (req, res) => {
    try {
      const parsed = insertTaskSchema.safeParse({ ...req.body, createdBy: req.user!.id });
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const task = await createTask(parsed.data);
      return res.json(task);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid task id" });
      const parsed = updateTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }
      const task = await updateTask(id, parsed.data);
      return res.json(task);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/archive", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid task id" });
      const task = await archiveTask(id);
      return res.json(task);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/tasks/:id/restore", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid task id" });
      const task = await restoreTask(id);
      return res.json(task);
    } catch (err: any) {
      return res.status(400).json({ message: err.message });
    }
  });

  return httpServer;
}
