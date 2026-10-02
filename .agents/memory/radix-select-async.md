---
name: Asynchronous Radix select events
description: Empty change events from native form selects while options load.
---

Radix Select controls inside forms may emit an empty string when controlled values are restored before asynchronous options mount. Treat that event as initialization, not as a user clearing a reference.

**Why:** On a direct task page, this converted valid project/milestone IDs to zero and erased sprint selection, making an unrelated title edit fail. The explicit none/backlog choices already represent clearing.

**How to apply:** Guard empty change events on async reference selects before numeric conversion. Verify direct-page loading and editing, not only navigation with warm query caches.