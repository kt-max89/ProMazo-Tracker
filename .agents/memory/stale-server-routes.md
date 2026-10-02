---
name: Stale server after route merge
description: Why new routes return Vite HTML after a task-agent merge without a server restart
---

A route merge can leave the preview serving an older route stack even when the source contains the correct handler. An API response with status 200 may be the frontend document rather than successful API data.

**Why:** `tsx server/index.ts` is a single-run process (not watch mode). Only a workflow restart loads the updated file.

**How to apply:** After any task-agent merge that touches server-side route files, restart the workflow before diagnosing "route not found" or "invalid JSON" errors from the client. Check the response content type and body directly. Absence of a response body in server logs is not evidence of HTML: privacy-sensitive endpoints intentionally omit logged bodies.
