---
name: Live collaboration boundaries
description: Product boundaries for saved-data synchronization and draft safety.
---

Synchronize saved shared work, not cursors or keystrokes. Preserve local drafts and
their deliberately selected task/project/sprint; offer explicit reload instead
of silently applying another person's edit. Do not describe this as prevention
of concurrent save overwrites.

**Why:** The requested collaboration model explicitly excludes merging, edit locks,
and optimistic concurrency; a draft warning is intentionally not a stale-save guarantee.

**How to apply:** Keep these boundaries when expanding the live domains or changing
editor initialization. Private chat and administrator destinations must remain
generic in presence, never private titles/content or action descriptions.