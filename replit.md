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
- AI-powered Q&A with streaming responses and citations
- Access control (per-user, per-domain, admin-only)
- Dark mode with localStorage persistence
- Persistent chat sessions with history sidebar

## Architecture
- `shared/schema.ts` — Single source of truth for DB schema and types
- `server/storage.ts` — Database operations (Drizzle ORM)
- `server/routes.ts` — Express API routes
- `server/openai.ts` — OpenAI integration (embeddings, streaming chat, chunking)
- `server/auth.ts` — Passport.js auth setup
- `client/src/App.tsx` — Frontend routing and providers
- `client/src/pages/` — Page components (chat, admin, history, auth)
- `client/src/components/theme-provider.tsx` — Dark/light mode provider

## Database Tables
- `users` — credentials and roles
- `documents` — file metadata and access control
- `chunks` — text segments with vector embeddings
- `citations` — tracks which chunks answered which queries
- `chat_sessions` — persistent chat conversations per user
- `chat_messages` — individual messages within chat sessions

## Running
- `npm run dev` starts Express + Vite on the same port
- `npm run db:push` syncs schema to database
