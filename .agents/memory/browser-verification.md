---
name: Browser verification availability
description: Browser testing fallback when the documented testing worker is unavailable.
---

Do not assume the documented specialized testing worker is available in every task environment. In this environment its launch was rejected as an unknown kind; direct Playwright against the running development app worked.

**Why:** Interactive composer sizing and signed-in proposal approval cannot be established by a signed-out screenshot or prompt unit tests alone.

**How to apply:** If the specialized worker is unavailable, use a focused local browser check with a disposable account and clean up only its records. Leave production authentication intact.