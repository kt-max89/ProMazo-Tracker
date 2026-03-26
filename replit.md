# Internal Notes Q&A Application

## Overview
RAG-powered document Q&A app that lets users upload documents and ask questions about them using AI. Answers include source citations.

## Tech Stack
- **Frontend**: React (TypeScript), Tailwind CSS, Shadcn UI, TanStack Query, Wouter
- **Backend**: Express.js (TypeScript)
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Drizzle ORM
- **Auth**: Passport.js with local strategy (session-based)
- **AI**: OpenAI API (embeddings: text-embedding-3-small, chat: gpt-4o-mini)

## Key Features
- Document upload & management (admin only)
- Google Drive integration for importing documents directly
- AI-powered Q&A with streaming responses (markdown rendered) and citations
- Access control (per-user, per-domain, admin-only)
- Dark mode with localStorage persistence
- Persistent chat sessions with history sidebar
- Task Tracker (Notion-style kanban board with full CRUD, archive/restore)

## Architecture
- `shared/schema.ts` — Single source of truth for DB schema and types
- `server/storage.ts` — Database operations (Drizzle ORM)
- `server/routes.ts` — Express API routes
- `server/taskService.ts` — Task business logic (listTasks, createTask, updateTask, archiveTask, restoreTask)
- `server/openai.ts` — OpenAI integration (embeddings, streaming chat, chunking)
- `server/auth.ts` — Passport.js auth setup
- `server/google-drive.ts` — Google Drive API integration (via Replit Connectors)
- `client/src/App.tsx` — Frontend routing and providers
- `client/src/pages/` — Page components (chat, admin, history, auth, tasks)
- `client/src/components/theme-provider.tsx` — Dark/light mode provider

## Database Tables
- `users` — credentials and roles
- `documents` — file metadata and access control
- `chunks` — text segments with vector embeddings
- `citations` — tracks which chunks answered which queries
- `chat_sessions` — persistent chat conversations per user
- `chat_messages` — individual messages within chat sessions
- `tasks` — task tracker (title, description, status, blocked_reason, is_archived, created_by, archived_at)

## Task Tracker API
- `GET /api/tasks` — list open tasks (is_archived=false)
- `GET /api/tasks/archived` — list archived tasks (is_archived=true)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/:id` — update task (Zod-validated partial update)
- `POST /api/tasks/:id/archive` — soft-archive task
- `POST /api/tasks/:id/restore` — restore archived task

## Running
- `npm run dev` starts Express + Vite on the same port
- `npm run db:push` syncs schema to database
