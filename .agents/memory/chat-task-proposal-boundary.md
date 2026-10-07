---
name: Chat task-proposal boundary
description: Protected behavior when improving the chat assistant's read and answer capabilities.
---

Treat task proposals as a protected subsystem when changing chat routing, retrieval, prompts, or read-only team support. Preserve the proposal JSON contract, validation and defaults, proposal event ordering, explicit approval step, and proposal review UI.

Assignment review is an intentional exception: chat creation approvals may assign multiple active members of the reviewer's current team, and explicit reviewed selections (including no selections) take precedence over model name suggestions. This restriction is specific to creation approval, not ordinary chat edits, general task access, or historical assignments.

**Why:** The user requested team-only multi-person chat assignment while explicitly excluding changes to other assignment controls, project/task visibility, and the model's single-name proposal format.

**How to apply:** Keep team eligibility confined to chat review/approval. Never reinstate the approver fallback after an explicit empty selection, or change model prompts to require multi-person IDs.

**Why:** The user explicitly identified task creation as the chat capability that already works well and asked that general assistant improvements not destabilize it.

**How to apply:** Separate read-tool orchestration changes from task-proposal behavior. If proposal context needs performance work, verify proposal accuracy and approval behavior independently before changing it.

Use isolated system prompts for existing-task edits rather than appending edit rules to the creation prompt.

**Why:** In live checks, the creation JSON example and best-effort drafting instructions caused the model to emit creation proposals for explicit edit requests despite an edit-rules addendum. Isolation prevents both format confusion and creation-default leakage.

**How to apply:** Keep edit clarification and partial-field semantics separate from creation drafting; never silently accept a creation proposal as an edit or create a replacement for an unresolved edit.

Follow-up edit history resolves task identity, not an accumulation of pending changes. Each new review concerns the latest requested fields only.

**Why:** Live model checks carried status/size changes from an earlier unapproved proposal into an "also clear its date" follow-up. That could reintroduce dismissed changes or overwrite fields the latest request did not address.

**How to apply:** Use history for identity only, then isolate latest-turn field/reference extraction as well as generation; reject out-of-turn fields. Review adjustments remain free before approval.

Validate generated reference identity against the resolved request, not merely existence or eligibility. This restriction ends at the editable review, where deliberate user adjustments are allowed.

**Why:** A valid-but-different project or person can pass ordinary mutation validation while still contradicting the chat request. Generation validation and reviewed approval have different responsibilities.

**How to apply:** Treat resolved names/IDs and requested assignee add/remove/replace semantics as the generation boundary; keep normal reference eligibility and consistency checks at approval.