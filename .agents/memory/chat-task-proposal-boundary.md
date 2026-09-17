---
name: Chat task-proposal boundary
description: Protected behavior when improving the chat assistant's read and answer capabilities.
---

Treat task proposals as a protected subsystem when changing chat routing, retrieval, prompts, or read-only team support. Preserve the proposal JSON contract, validation and defaults, proposal event ordering, explicit approval step, and proposal review UI.

**Why:** The user explicitly identified task creation as the chat capability that already works well and asked that general assistant improvements not destabilize it.

**How to apply:** Separate read-tool orchestration changes from task-proposal behavior. If proposal context needs performance work, verify proposal accuracy and approval behavior independently before changing it.