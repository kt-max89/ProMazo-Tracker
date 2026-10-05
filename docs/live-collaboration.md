# Live saved-data synchronization

## Boundaries

This feature synchronizes saved shared data, not keystrokes. It does not prevent
concurrent save overwrites. Task dialogs, task detail pages, board side panels,
project editors, working agreements, and sprint-plan editors retain local drafts.
Changed saved records show an explicit discard/reload choice. New post and
reflection drafts stay local; a remote current-sprint change does not retarget
an already initialized reflection/task/plan draft.

Only minimal domain names travel as change notifications. Browsers refetch through
existing authenticated REST endpoints. Chat, proposals, documents, credentials,
and admin records are not broadcast. Chat/history/admin destinations share the
generic “Private workspace” presence label. Names come from the authenticated
database user, never a client-supplied identity.

## Cross-instance operation

Each process uses one dedicated PostgreSQL LISTEN connection outside the REST/session
pool (maximum ten pooled connections). A real cross-connection NOTIFY round trip
verifies support, rather than assuming that a successful LISTEN statement is enough.
Listener loss reconnects with bounded backoff and emits a recovery refresh.

A small PostgreSQL revision table stores one counter per shared domain; it is
not event history. Each process also reads counters every three seconds. This is
the supported shared alternative when a connection proxy cannot retain LISTEN
state. Clients show “Fallback” and receive fresh presence snapshots and saved-data
updates in that mode. Notification failure never changes a committed save into
an error; the client safety refresh covers missed publications.

Streams have no replay guarantee. Every connection/recovery and active-tab return
refreshes shared query roots. Browsers coalesce invalidations for 250 ms, refresh
active shared data every sixty seconds, and poll every ten seconds while disconnected.
Inactive cached queries are marked stale for the next visit. Documents/private
chat/admin queries are excluded from the shared refresh map.

## Normal timing and limits

- Saved changes: usually 1–2 seconds with LISTEN, roughly 1–4 seconds via shared
  revision polling on a healthy database/network.
- Presence heartbeat: every twelve seconds, with immediate attempts on focus/page
  changes (subject to a 2.5-second client throttle and a two-second server limit).
- Active/idle: idle after sixty seconds without pointer/keyboard activity, or when
  the tab is hidden. Any active unexpired tab makes that user's single avatar active.
- Leases: forty-five seconds. Last-tab departure is best-effort immediate; abrupt
  browser/network loss disappears from avatars within roughly fifty-five seconds
  (lease plus ten-second roster expiry check).
- Explicit logout destroys the session and removes its leases. Deactivation/version
  changes immediately filter presence and signal all instances; streams revalidate
  before notifications and at least every ten seconds while quiet. Reactivation
  never restores an old session.
- Up to twelve leases per user across instances; twelve simultaneous SSE connections
  per user per process; two hundred SSE connections per process; roster capped at
  two hundred users. Each process bulk-checks sessions instead of borrowing one
  connection per browser. Expired leases are deleted in batches of five hundred.
- Consumers whose queued SSE writes exceed 32 KiB are disconnected and recover by
  refetch. No unbounded notification queue is maintained.

This is intended for a modest team workspace, not thousands of simultaneously
connected users. Capacity/load testing beyond these targeted limits is separate
from the functional browser tests.

## Schema and publishing

Schema source of truth: `server/schema.ts`. Development: `npm run db:live`,
also included in the existing post-merge setup script. New tables are
`live_revisions` and `presence_leases`; existing work is not replaced. No live-feature
DDL runs during production startup or build. Replit Publish applies the development
schema diff to the managed production database; do not select “overwrite data.”

The currently published version predates these routes. Its production PostgreSQL
version was confirmed read-only, but the new authenticated stream and its listener
cannot be verified in that old deployment. After merging and republishing:

1. Sign in to the published app in two separate user browsers.
2. Open `/api/live/status` while signed in. It reports `listen-notify` only after
   the runtime cross-connection probe passes; otherwise it reports the explicit
   `shared-revision-polling` alternative. No database credentials are exposed.
3. Check `/api/live/events` in the browser network panel: streamed
   `text/event-stream`, `no-cache, no-transform`, immediate ready frame, recurring
   heartbeat frames. If the proxy terminates a long response, reconnection should
   refresh rather than require a page reload.
4. Save a disposable task in one browser and observe its change in the other;
   open a draft in the other browser and confirm it remains intact. Test logout
   and multiple tabs, then remove only the disposable test work through the app.

Do not run the development test scripts against a production database.

## Verification

- `npm test`: targeted protocol schemas, mutation/query map, independent coordinators,
  actual LISTEN delivery, listener reconnection, shared polling fallback, and existing
  regression tests.
- `npm run build`: production frontend/server bundle.
- `npm run test:live-browser`: disposable signed-in users, one server through the
  Replit development proxy and a second independent production-bundle process
  sharing PostgreSQL. Covers domain propagation, failed writes, chatbot approval,
  task/project/agreement/plan/post/reflection drafts, indirect milestone changes,
  multiple tabs, safe location labels, idle/expiry, disconnect/reconnect, logout,
  deactivation/reactivation, expired sessions, overflow, and mobile headers.
- `npm run check`: run and compare with the existing errors. This task does not
  resolve the pre-existing duplicate `onBlur`, old compiler Set iteration,
  PDFParse private method, Express parameter unions, or proposal-size typing errors.