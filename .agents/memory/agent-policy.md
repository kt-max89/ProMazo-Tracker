---
name: Admin-editable agent policy
description: Authority and safety boundaries for configurable chatbot instructions, and policy verification.
---

Use the existing Admin role for viewing and editing the main chatbot instructions; do not introduce a Super Admin role for this feature.

**Why:** The user explicitly chose all current admins when asked whether this feature needed a separate role.

**How to apply:** Keep both read and write APIs admin-only, without changing general project access or document permissions.

Editable assistant policy must remain separate from the application's creation/edit response contracts and explicit review/approval requirements.

**Why:** These contracts are required by working chat creation and editing flows. Making them arbitrary editable text could silently break those flows even when the policy itself saves correctly.

**How to apply:** Display technical contracts read-only for inspection; keep creation and edit contracts isolated, with application rules taking precedence over configured general policy.

Verify policy delivery separately from model compliance.

**Why:** A live conditional answer-style check was ignored even though a direct orchestrator capture contained the exact saved policy. Saving, sending, and following instructions are distinct claims.

**How to apply:** Inspect outgoing system policy deterministically, then test real replies independently. Do not claim model compliance based only on successful persistence or prompt construction.
