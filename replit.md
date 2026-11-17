# Internal Notes Q&A Application

## Overview
RAG-powered document Q&A app that lets users upload documents and ask questions about them using AI. Answers include source citations.

## Tech Stack
- **Frontend**: React (TypeScript), Tailwind CSS, Shadcn UI, TanStack Query, Wouter
- **Backend**: Express.js (TypeScript)
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Drizzle ORM
- **Auth**: Passport.js with local strategy (session-based)
- **AI**: Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) for read/create chat; OpenAI for isolated task edits, chat titles, legacy document helpers, and embeddings (`text-embedding-3-small`).

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
Turn flow: isolated existing-task edit gate → protected edit model **or** Sonnet read-only lookup loop → validated answer → existing explicit proposal review.

- `server/toolIntentSelector.ts` — OpenAI edit gate and latest-message-only edit extraction; shared reader schemas and legacy normalization. No predictive read/create routing.
- `server/chatLookupLoop.ts` — Sonnet selects native tools, inspects results, and can repeat lookups: at most five tool rounds, three executed calls per round, fifteen calls total. A tools-disabled sixth request finalizes if needed. Each provider request times out after 30 seconds; individual reads after 10 seconds. Results are capped at 6,000 characters per call / approximately 12,000 per round; truncation is explicit. Malformed responses and provider failures produce a safe answer without proposals.
- `server/lookupTools.ts` — Strict validation and operational guidance for exactly five readers: `see_tasks`, `see_projects`, `see_team`, `read_docs`, `read_project_context`. No write or edit preparation tools.
- `server/claudeProvider.ts` — Server-only Anthropic Messages API adapter with a concrete Sonnet model; no provider fallback.
- `server/seeTasksTool.ts` — Individual-word discovery search, related-task retrieval, due date / size / sprint output. Identity-sensitive existing-task edit search remains separate.
- `server/readDocsTool.ts` / `server/documentRetrievalService.ts` — Permission-aware embedding + pgvector retrieval. Repeated reads retain stable citation numbering and deduplicated persistence.
- `server/promptBuilder.ts` — Fresh admin policy, bounded history, automatic team/sprint sources, project/milestone context, and protected creation/edit contracts. Retrieved content and history remain untrusted data.
- `server/creationGrounding.ts` — Checks generated names against fresh references, surfaces ambiguity for review, and prevents unresolved references from reaching legacy first-match fallbacks. Existing approval eligibility/defaults remain unchanged.
- `server/chatOrchestrator.ts` — Maintains SSE progress (including repeats), citations, saved history, session titles, and `done` before proposal event ordering. Creation proposals require a successful relevant board search; possible related tasks are explicitly surfaced. Nothing writes tasks before approval.

### Chat provider setup

Store `ANTHROPIC_API_KEY` in server-side Replit Secrets in each environment that runs chat. The key needs Anthropic Messages API access and billing for `claude-sonnet-4-6`; model reference: https://platform.claude.com/docs/en/about-claude/models/overview. Never place credentials in source, browser variables, logs, or PR text. Missing configuration returns a clear setup error, never an OpenAI downgrade.

Keep `OPENAI_API_KEY`: the existing isolated edit gate/model, latest-message extraction, embeddings, legacy helpers, and chat-title generation intentionally continue using OpenAI. No schema migration is required.

Verification: `npm test`, `npm run check`, `npm run build`; live signed-in checks: `npx tsx tests/chat-lookup.browser.ts`, `npm run test:chat-browser`, `npx tsx tests/task-edits.browser.ts`. These require a running development workflow, development database, configured providers, and Chromium. Browser fixtures use normal login and clean up only their own records.

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
