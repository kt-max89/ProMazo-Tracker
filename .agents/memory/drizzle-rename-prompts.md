---
name: Drizzle table rename prompts
description: Safety guidance for applying Drizzle schema pushes in this workspace.
---

When Drizzle's interactive schema push proposes renaming an existing table into a new table, do not accept the suggestion without confirming the tables are genuinely the same data model.

**Why:** Schema matching can infer a rename from a similarly shaped unmanaged table (such as the session table). Accepting that guess risks replacing unrelated production data rather than creating the intended table.

**How to apply:** Choose an explicit create-table migration or use the application's idempotent startup migration for new tables when the rename suggestion is not unquestionably correct.