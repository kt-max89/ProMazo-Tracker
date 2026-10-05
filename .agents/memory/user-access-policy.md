---
name: User access policy
description: Initial administrator setup, account preservation, and registration security boundaries.
---

The designated initial administrator is a one-time reconciliation, not a permanent allowlist. Later administrator promotions must survive restart and publish. Keep existing accounts, passwords, membership, work ownership, and history.

**Why:** The requested product workflow gives administrators ongoing user-management authority; rerunning a sole-admin reset would undo legitimate management actions.

**How to apply:** Never turn the initial setup into a per-start role reset. Keep local email/password authentication and document-management behavior unless a later request explicitly changes them.

Deactivation must permanently revoke existing sessions while preserving the account and password; reactivation allows a fresh login, not reuse of an old session.

**Why:** Deactivation is an access-removal operation. An old session must not regain access silently after reactivation.

**How to apply:** Preserve this boundary when changing session storage or authentication. The shared signup code belongs only in Secrets, never in tracked files or memory.

Inactive users must not appear as task-assignment dropdown options, but their existing task assignments and historical names must remain intact.

**Why:** The user requested exclusion from assignment choices, not removal of past ownership or hiding users from all historical lookups.

**How to apply:** Keep assignment eligibility separate from the full user directory used to resolve saved assignees. Reactivation should make the user selectable again.