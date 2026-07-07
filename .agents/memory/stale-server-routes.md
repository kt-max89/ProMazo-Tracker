---
name: Stale server after route merge
description: Why new routes return Vite HTML after a task-agent merge without a server restart
---

When a task agent merges new Express routes to disk, the running `tsx` dev server does NOT hot-reload server files. The stale process keeps its old route stack. Any path that wasn't in the old stack falls through to Vite's `app.use("/{*path}", ...)` catch-all, which returns HTTP 200 with the full HTML page — not JSON. The Express logging middleware still logs `GET /api/xxx 200 in Xms` but with no `:: body` (because `res.json` was never called; Vite uses `res.end()`).

**Why:** `tsx server/index.ts` is a single-run process (not watch mode). Only a workflow restart loads the updated file.

**How to apply:** After any task-agent merge that touches server-side route files, always restart the workflow before diagnosing "route not found" or "invalid JSON" errors from the client. Check for the `:: body` absence pattern in logs as the first signal.
