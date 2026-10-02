---
name: Workspace runtime environment labels
description: Runtime environment flags can mislabel the agent workspace's database context.
---

The agent workspace reported a production runtime-environment label while the configured database was the managed development database.

**Why:** A development-only schema command rejected a confirmed development target because it trusted that label. Read-only checks through the development database tool and the app connection confirmed the same development database.

**How to apply:** Do not treat the runtime-environment label alone as proof of a production database. Confirm the intended target through database tooling before writes. Keep development schema commands out of production startup/build; managed production schema changes belong to Publish.