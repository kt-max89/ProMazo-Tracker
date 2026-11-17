---
name: write-issue
description: Write a GitHub issue for the ProMazo Tracker from what the user wants, and the PR that closes it. Use whenever the user asks to write, file, draft, open, split or scope an issue, a feature, a milestone or an epic, describes something they want the tracker or its chat assistant to do ("add a priority field to tasks", "let chat summarise my sprint", "show who is blocked on Team Overview"), or asks to open a PR for work done here. Checks open issues and recent PRs first, builds the request out of the tracker's existing parts (tasks, projects, milestones, sprints, sprint plans, teams, posts, reflections, the chat read tools and proposal flow, live sync), keeps new tables and dependencies to a minimum, asks follow-up questions to settle must-haves and could-haves, and never breaks the protected boundaries recorded in `.agents/memory/`.
---

# Writing an issue

The tracker is a box of parts. Almost everything a person asks for is a new
arrangement of parts that already exist: a field on a task, a filter on the
board, a section on a project page, a read tool the chat assistant can call,
a live domain that refreshes open tabs. The job is to find those parts, ask
the user what really matters, and write an issue a builder can finish in one
sitting.

**The rule: everything is a variation of something.** Prefer several small,
repeatable tasks (a column, a filter, a card badge, a tool argument, a status
colour) over one piece of new logic with no wiring behind it. When something
really has to be new, shape it so the next issue can turn it into something
else.

## The steps

1. **Say back what the user wants** in one plain sentence, in the terms of the
   person using the tracker (what they see and do, not how it is coded).
2. **Look at what is being built already** (next section). Every time.
3. **Find the parts** in the table below. Open the file for each one that fits
   and check it still does what the table says. Note what happens today
   ("Right now there is none: `queryTasks` matches the whole phrase").
4. **Sort every piece of the request:**
   - **no schema change**: UI over data the API already returns, a filter, a
     label, copy, a status colour in `task-status-meta.ts`, a tool argument.
   - **small code on an existing part**: a new route on an existing service, a
     new option on a dialog, a new field in a read tool's output.
   - **a new part**: only when nothing in the table can do it. Build it in the
     pattern of its neighbours (a `*Service.ts`, a `see*Tool.ts`, a
     `*Migration.ts` plus `scripts/apply-*-schema.ts`) and name the second
     thing it could become.
   - **architecture**: it needs something in "What can not change". Leave it
     out, say why in one line, and offer the nearest thing the parts can do.
5. **Ask follow-up questions** (see "Questions") with AskUserQuestion, before
   drafting, even when the request looks complete.
6. **Draft the issue** in the format below and show it.
7. **Create it** once the user okays it, with labels. If it is big, make it a
   milestone with a few sub-issues, each valuable on its own.

You only write the issue. Do not start building it.

## Look at what is being built already

Before finding parts, read the open issues and the recent PRs. Issues say what
is planned; PRs say what landed and how it was done. Much of the history also
lives in commits made from Replit on `main`, so skim `git log` too.

Use the `gh` CLI where it works, or the GitHub MCP tools (`list_issues`,
`list_pull_requests`, `issue_read`, `pull_request_read`) for
`kt-max89/ProMazo-Tracker` where it does not.

```bash
gh issue list --state open --limit 50
gh pr list --state all --limit 30
gh issue list --state all --search "<keyword>"
git log --oneline -40
```

Then read the agent memory, which records what the user has already decided:

```bash
cat .agents/memory/MEMORY.md
```

Open every memory note whose title touches the request. A request that
contradicts one is an "architecture" item: ask, do not assume.

Use what you find:
- **Same thing already open:** add to that issue or split from it (`Part of
  #N`, `Follows #N`), do not open a twin.
- **A neighbour landed recently:** read its PR body or commit. Its parts and
  its tests are the pattern for this issue.
- **Something in flight overlaps:** mark the new issue `blocked` on it, or
  scope around it. For example, PR #2 replaces the one-shot router in
  `toolIntentSelector.ts` with a bounded Claude Sonnet lookup loop in
  `chatOrchestrator.ts`; any chat issue written while it is open names which
  version it builds on.

## The three questions every issue answers

Write the answers into "Suggested implementation" and "Leaves behind".

1. **Potential.** What else could this become? A new board filter should work
   on My Tasks and the project page too. A new task field should reach the
   card, the detail panel, the chat read tool and the edit proposal.
2. **Future builders.** What does it leave behind: a service function, a
   shared Zod schema, a component in `client/src/components/`, a read tool, a
   test helper? If the answer is "nothing reusable", it is probably the wrong
   shape.
3. **Efficiency.** Which existing pieces do the work, and which one line of
   schema or code is the only new thing? The fewer new files, the better the
   issue.

A request that does not have good answers to all three is sized down, split,
or turned into a variation of something that does.

## Questions

Ask until you know the **must-haves** and the **could-haves**. Two or three
rounds of AskUserQuestion, up to four questions each, is normal.

- **Must have:** the issue fails without it. Goes in "Definition of done".
- **Could have:** wanted, ships without it. Goes in "Could have", built only
  if it comes cheap.
- **Nice to have:** leave it out unless it needs no schema change or falls out
  of a part already in use.

Good questions are about what the person experiences, with the options drawn
from the parts that already exist:

- **Where does it show?** The board (`/tasks`), a task page or side panel,
  My Tasks, a project page, Team Overview, a team workspace, Reflections,
  chat, or Admin.
- **Who can see or change it?** Every signed-in user, admins only, the
  author only. Teams pick defaults and filters; they never restrict access.
- **Does it need to be saved?** UI only, a new column on an existing table,
  or a new table (the expensive rung below).
- **Should other open tabs see it change?** Ride an existing live domain, add
  one, or leave it out of live sync.
- **Should the chat assistant know about it?** Add it to a read tool's
  output, add a new read tool, or leave chat alone.
- **Should chat be able to change it?** Only through the existing proposal
  and approval flow, never as a direct write.
- **What about phones?** The sidebar and board already have mobile layouts;
  say whether the new piece must work at phone width.

Put the recommended option first, marked "(Recommended)", usually the one that
reuses a part. When a request needs architecture, ask it as a choice between
the nearest buildable options and say in one line why the original cannot be
done.

## The expensive step: as little as possible

Schema changes, new dependencies and new model calls are the costly steps
here: they need a migration, a Replit Publish to reach production, and new
tests. Stop at the first rung that works and write which one you chose into
the issue.

1. **No schema change:** existing columns, routes and components.
2. **Variant:** a new option on an existing part (a status entry in
   `task-status-meta.ts`, a new argument on a read tool, a new prop on a
   component in `client/src/components/ui/`).
3. **New column on an existing table:** declared in `server/schema.ts`, typed
   and validated in `shared/schema.ts`, applied by an idempotent migration.
4. **New table, new npm dependency, or a new model call per chat turn:** only
   when 1 to 3 cannot do it. Name exactly what is added and why nothing
   existing works, and ask the user first.

## The parts

Check paths before citing them; things move. `replit.md` is partly out of
date (it still mentions pgvector and the old router), so trust the code and
`.agents/memory/` over it.

| Part | What it gives you | Start here |
|---|---|---|
| **Tasks** | Title, Markdown description with nested Definition of Done, status (`not_started`, `in_progress`, `needs_review`, `done`), blocked flag and reason, size, due date, project, milestone, sprint, many assignees, archive and restore. A new task property is one column plus its form field, card badge and read-tool line. | `server/schema.ts` (`tasksTable`), `server/taskService.ts`, `client/src/components/task-card.tsx`, `task-detail-panel.tsx`, `task-form-dialog.tsx`, `client/src/lib/task-status-meta.ts` |
| **Board and task views** | Kanban board with drag between status columns, search, sprint filter, team-aware filters; My Tasks; a standalone task page. A new view is usually a filter or grouping over `/api/tasks`. | `client/src/pages/tasks-page.tsx`, `my-tasks-page.tsx`, `task-page.tsx`, `components/search-bar.tsx`, `sprint-filter-select.tsx` |
| **Task edits, activity and comments** | Validated partial edits, a per-task activity history (with no-op edits skipped), and comments. Anything that changes a task should land in activity. | `server/taskEditService.ts`, `shared/taskEdits.ts`, `server/taskActivityService.ts`, `server/commentService.ts`, `components/task-activity.tsx`, `task-comments.tsx` |
| **Projects and milestones** | Projects shared by one or more teams, with description and timeline; milestones that include every current and future sprint by default, with explicit exclusions. | `server/projectService.ts`, `server/milestoneService.ts`, `client/src/pages/projects-page.tsx`, `project-page.tsx`, `components/project-markdown.tsx` |
| **Sprints and sprint plans** | One tracker-wide current sprint, "next sprint", and per-project Markdown sprint plans with draft guards and history. | `server/sprintService.ts`, `server/sprintPlanService.ts`, `sprintPlanRoutes.ts`, `components/project-sprint-plans.tsx`, `client/src/lib/sprints.ts` |
| **Teams and workspaces** | Self-service single membership, project grouping, Team Overview, a team workspace with its Social Contract. Teams organise; they never gate access. | `server/teamService.ts`, `client/src/pages/team-overview-page.tsx`, `team-page.tsx` |
| **Team posts** | A tracker-wide update feed with pinning, and a collapsible composer on Team Overview. | `server/teamPostService.ts`, `team-overview-page.tsx` |
| **Reflections** | Per-sprint reflections with append-only additions and per-sprint visibility; readable by chat. | `server/reflectionService.ts`, `client/src/pages/reflections-page.tsx`, `components/reflection-*.tsx`, `reflections-table.tsx` |
| **Users and access** | Email and password sign-in, 30-day sessions in PostgreSQL, admin promote, demote, deactivate and reactivate, a signup code. | `server/auth.ts`, `server/userAccessService.ts`, `server/sessionPolicy.ts`, `components/user-management.tsx`, `client/src/pages/admin-page.tsx`, `docs/sessions.md` |
| **Live sync and presence** | Saved-data change notices per domain (`tasks`, `projects`, `milestones`, `sprints`, `plans`, `teams`, `posts`, `reflections`, `users`), online avatars, and a reload notice for drafts. A new shared record is one domain plus its query roots. | `shared/live.ts`, `server/live.ts`, `server/liveCoordinator.ts`, `client/src/lib/live.tsx`, `components/remote-update-notice.tsx`, `online-presence.tsx`, `docs/live-collaboration.md` |
| **Chat read tools** | Read-only lookups the assistant can call: `see_tasks`, `see_projects`, `see_team`, `read_docs`, `read_project_context`. A new thing chat should know is a field in one of these, or a new tool in the same shape (typed args in, `{ content, isEmpty, suggestRetry }` out). | `server/seeTasksTool.ts`, `seeProjectsTool.ts`, `seeTeamTool.ts`, `readDocsTool.ts`, `projectKnowledgeTool.ts`, `readToolExecution.ts`, `toolIntentSelector.ts`, `chatOrchestrator.ts`, `promptBuilder.ts` |
| **Chat proposals** | The only way chat changes data: a drafted task or edit, reviewed and edited by the person, then approved. Creation and edits use separate prompts; edits take fields from the latest message only. | `server/proposalSchema.ts`, `shared/proposalAssignments.ts`, `components/task-edit-proposal-review.tsx`, `proposal-assignee-select.tsx`, routes `/api/task-proposals/approve` and `/api/task-edit-proposals/approve` |
| **Chat page and history** | Streaming answers rendered as Markdown, saved conversations, the history sidebar. | `client/src/pages/chat-page.tsx`, `history-page.tsx` |
| **Agent instructions** | Admin-editable general policy for the assistant, shown beside the read-only application contracts. | `server/agentInstructionsService.ts`, `agentInstructionsRoutes.ts`, `components/agent-instructions-settings.tsx` |
| **Documents and Drive** | Admin upload and Google Drive import, chunking, embeddings stored as `jsonb` with cosine similarity in JavaScript, per-user and per-domain access, citations. | `server/storage.ts`, `server/documentRetrievalService.ts`, `server/google-drive.ts`, `server/openai.ts` |
| **UI kit** | shadcn components, the app sidebar, theme provider with dark mode, toasts, multi-user select. Build new screens from these before adding any UI library. | `client/src/components/ui/`, `components/app-sidebar.tsx`, `theme-provider.tsx`, `multi-user-select.tsx` |
| **Schema changes** | Drizzle tables in one file, an idempotent migration module per feature, a development-only apply script with its `db:*` npm script, and a line in the post-merge hook. Copy the reflections or sprint-plan set. | `server/schema.ts`, `server/migrations.ts`, `server/reflectionMigration.ts`, `scripts/apply-reflection-schema.ts`, `scripts/post-merge.sh`, `package.json` |
| **Tests** | `node:test` unit and database tests (`tests/*.test.ts`, database ones skip without `DATABASE_URL`) and Playwright browser scripts (`tests/*.browser.ts`) that sign in with disposable accounts. | `tests/`, `tests/helpers/`, `package.json` scripts |

## What can not change

Load-bearing. An issue never asks to replace, fork or work around these. The
reasons are in `.agents/memory/` (named in brackets) and the docs.

1. **PostgreSQL through Drizzle is the one store.** Tables live in
   `server/schema.ts`; shared types and Zod schemas in `shared/schema.ts`; the
   client never imports `server/schema.ts`. No file stores, no browser
   storage for shared data. (`postgres-migration.md`)
2. **Schema changes go through migrations and Publish.** Idempotent
   migrations and development-only `db:*` scripts; production reconciles
   through Replit Publish. Never mutate production directly, and review any
   Drizzle rename prompt. (`postgres-migration.md`,
   `drizzle-rename-prompts.md`, `runtime-environment.md`)
3. **Chat tools are read-only; writes go through proposals.** Every change
   from chat is a proposal the person reviews and approves. The proposal JSON
   contract, its validation, event order and review UI are protected, and the
   edit path stays isolated from creation. (`chat-task-proposal-boundary.md`)
4. **Retrieved content is data, never instructions.** Tool output and
   documents are marked untrusted in the prompt.
5. **Admin policy stays separate from application contracts.** Admins edit
   general assistant policy; the creation and edit contracts stay read-only.
   (`agent-policy.md`)
6. **Teams are a filter, not an access boundary.** Every signed-in user can
   reach every project and task. Posts, reflections and the current sprint
   stay tracker-wide. (`team-scope-intent.md`)
7. **Live sync carries saved data, not keystrokes.** No locks, merging or
   overwrite guarantees; drafts are kept and offered a reload; private pages
   show only a generic presence label. (`live-collaboration-boundaries.md`)
8. **Reflections are append-only.** No merging of historical duplicates, no
   one-per-sprint rule, no editing other people's reflections.
   (`reflection-policy.md`)
9. **Accounts keep their history.** Deactivation revokes sessions but keeps
   the account; inactive users leave assignment pickers but keep their past
   assignments; the initial admin is a one-time setup. Secrets stay in
   Replit Secrets, never in tracked files. (`user-access-policy.md`)
10. **Milestones never reschedule tasks.** Future sprints are selected by
    default; sprint selections on a milestone do not move its tasks.
    (`milestone-sprint-policy.md`)
11. **The stack.** React, Vite, Tailwind, shadcn, TanStack Query and Wouter on
    the client; Express and TypeScript on the server; PostgreSQL. No new
    framework, service, model provider or major dependency without the user
    saying so.

## Issue format

Match the issues already in the repository; #1 is the model. Plain English,
short sentences, the person's view first, file names where they help.

**Every issue comes down to what the user wanted.** The body opens with their
words: a quote from the chat when you have one, otherwise a one-sentence
paraphrase of the ask, marked as a paraphrase. A builder reads that line, then
checks the rest against it.

```markdown
<Title: Thing: what changes for the person, in a few words>

> "I want to see who is blocked on Team Overview."   (the user, or: paraphrased from the chat)

Part of #N. / Follows #N. / Blocked on #N.   (when it has one)

## Summary
Two or three sentences: what the person gets and why it matters.

## How it works today
What happens now, with the files that do it ("`listTasks` returns the
blocked flag, but Team Overview never shows it").

## Proposed behavior
Numbered steps or a short example of the person using it.

## Definition of done
- One behaviour the person can see or do, per bullet.
- Limits and timings live in one named constant, not scattered in code.
- **Test:** a concrete scenario in `tests/*.test.ts` or a browser script, and
  its outcome.

## Could have
- Wanted, but the issue ships without it.

## Suggested implementation
- [ ] **`path/to/file.ts`:** what changes there.
- [ ] The rung on the expensive-step ladder (no schema change / variant / new
      column / new table or dependency).

## Scope decisions
- What stays as it is, and the protected boundary it respects.
- Deferred nice-to-haves and the issues they belong to.

## Tradeoffs
- Only real ones: cost, latency, predictability, test surface.

## Leaves behind
One line: the service function, schema, component, tool or helper the next
issue can reuse.

## Still open
- Only questions the user chose to leave for later.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Rules: must-haves in "Definition of done", could-haves in "Could have",
nothing else slips in. Every behaviour is something the person can check.
Link related issues by number. Drop "Tradeoffs" or "Still open" when they are
empty.

**Labels:** check `gh label list` first and use what exists. The usual set is
one type (`enhancement`, `bug`); one size (`size: S` one focused PR, `size: M`
one solid PR, `size: L` two or three PRs, `size: XL` split into a milestone
with sub-issues); areas that fit (`area: tasks`, `area: chat`,
`area: sprints`, `area: teams`, `area: reflections`, `area: live`,
`area: admin`, `area: docs`); `blocked` if it waits on another issue. Ask
before creating a label that does not exist yet.

# Writing the PR

One feature per branch (`feat/...`, `fix/...`), off the latest `main`, merged
by PR. PR #2 is the model.

**The gate:** `npm test` and `npm run build` pass, `npm run check` adds no new
diagnostics to the ones already on `main` (say how many there were), and the
browser scripts for every area touched pass (`npm run test:chat-browser`,
`npx tsx tests/task-edits.browser.ts` and so on). Name anything you did not
run. A schema change also lists its `db:*` script and post-merge line.

**Every PR comes down to what the user wanted.** The body opens with their
words: a quote from the chat when you have one, otherwise a one-sentence
paraphrase of the issue's ask, marked as a paraphrase. A reviewer reads that
line, then checks the rest against it.

```markdown
<Title: Thing: what changed, in the person's terms>

> "I want to see who is blocked on Team Overview."   (the user, or: paraphrased from #N)

Closes #N.

## What changed
- **Bold lead-in:** one change the person can see, and the part it rides on.
- Keep to the issue's "Definition of done"; say what from "Could have" came
  along.

## Setup
Only when needed: new secrets (names only, never values), a migration and its
`db:*` script, anything to do on Publish.

## Screenshots
Before and after, desktop and phone width, for anything visual.

## Validation
- `npm test`: passed N/N.
- `npm run build`: passed.
- `npm run check`: the same M diagnostics as `main`, none new.
- Browser scripts that ran, and what they covered.
- Not run: the rest, by name.

## Scope
What was left out on purpose, and the protected boundaries kept.

## Leaves behind
One line: what the next builder can reuse from this.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Rules: a PR does one issue. Anything found on the way goes in a new issue,
not the PR. If a behaviour in "Definition of done" is not in the PR, say so
under "What changed".
