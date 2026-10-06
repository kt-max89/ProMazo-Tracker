---
name: Chat task-proposal boundary
description: Protected behavior when improving the chat assistant's read and answer capabilities.
---

Treat task proposals as a protected subsystem when changing chat routing, retrieval, prompts, or read-only team support. Preserve the proposal JSON contract, validation and defaults, proposal event ordering, explicit approval step, and proposal review UI.

Assignment review is an intentional exception: chat approvals may assign multiple active members of the reviewer's current team, and explicit reviewed selections (including no selections) take precedence over model name suggestions. This restriction is specific to chat approval, not general task access or historical assignments.

**Why:** The user requested team-only multi-person chat assignment while explicitly excluding changes to other assignment controls, project/task visibility, and the model's single-name proposal format.

**How to apply:** Keep team eligibility confined to chat review/approval. Never reinstate the approver fallback after an explicit empty selection, or change model prompts to require multi-person IDs.

**Why:** The user explicitly identified task creation as the chat capability that already works well and asked that general assistant improvements not destabilize it.

**How to apply:** Separate read-tool orchestration changes from task-proposal behavior. If proposal context needs performance work, verify proposal accuracy and approval behavior independently before changing it.