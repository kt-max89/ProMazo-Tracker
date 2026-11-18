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
- `server/taskService.ts` — Task business logic (listTasks, createTask, updateTask, archiveTask, restoreTask, getTaskCounts, getTasksByStatus, searchTasks, getCompactTaskContext)
- `server/openai.ts` — OpenAI integration (embeddings, streaming chat, chunking)
- `server/auth.ts` — Passport.js auth setup
- `server/google-drive.ts` — Google Drive API integration (via Replit Connectors)
- `client/src/App.tsx` — Frontend routing and providers
- `client/src/pages/` — Page components (chat, admin, history, auth, tasks)
- `client/src/components/theme-provider.tsx` — Dark/light mode provider

### Chat Orchestration Layer
Turn flow: intent selection → one tool call (or none) → final streaming answer.

- `server/toolIntentSelector.ts` — Single non-streaming LLM call using OpenAI function-calling to select SEE_TASKS | READ_DOCS | NO_TOOL plus typed args. Replaces the old keyword/regex router. If model returns no tool call, intent is NO_TOOL.
- `server/seeTasksTool.ts` — Clean typed task retrieval (SeeTasksArgs → SeeTasksResult). Wraps getTaskCounts/getTasksByStatus/searchTasks. Returns isEmpty flag and retry suggestion when no tasks match.
- `server/readDocsTool.ts` — Clean typed doc retrieval (ReadDocsArgs → ReadDocsResult). Wraps documentRetrievalService. Returns isEmpty flag and retry suggestion when no chunks found.
- `server/documentRetrievalService.ts` — Underlying embedding + pgvector similarity search layer; called only by readDocsTool.
- `server/promptBuilder.ts` — Builds OpenAI messages array from ToolResult (type, content, isEmpty, suggestRetry). When empty, instructs model to acknowledge and surface the retry suggestion verbatim.
- `server/chatOrchestrator.ts` — Async generator enforcing one-tool-call-per-turn structurally: intent selector → single if/else tool branch → final LLM call with no tools defined (second tool call is architecturally impossible). Stub comment block for future proposed task actions (create_task, update_task_status, archive_task).

### Clarifying Questions
- `shared/clarifyingQuestion.ts` — Parser and formatter for the agent's optional `questions` sidecar (1–4 questions, each with 0–4 suggested answers and an optional `recommendedIndex`).
- The final chat JSON may include `questions` instead of a proposal. The orchestrator emits a `questions` SSE event and stores the questions as markdown in the assistant message so the next turn sees them.
- `client/src/components/clarifying-questions.tsx` — Renders each question as clickable suggestions plus a "type your own answer" box, with **Submit answers** and **Skip all**.
- Answers go back to `POST /api/chat` as a structured `questionResponse` (no `query`). The server formats the user message and, for every skipped question, adds a system instruction telling the agent to make conservative choices and say "You didn't answer, so I guessed ... because ...". After Skip all, any new questions are dropped so the agent must act.

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
