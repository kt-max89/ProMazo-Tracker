---
name: Session hosting verification
description: HTTPS preview cookie rewriting and asynchronous session-store verification.
---

Verify the app's cookie policy separately from the development preview edge.
The HTTPS preview was observed rewriting application `SameSite=Lax` cookies to
`SameSite=None; Secure` for its iframe. Do not weaken the origin policy to match
that edge behavior, or claim a preview check proves published-host behavior.

**Why:** A browser assertion initially appeared to show a security-policy
regression even though the origin emitted Lax and correctly detected forwarded
HTTPS. Only SameSite was rewritten outside the application.

**How to apply:** Assert origin attributes in integration tests, inspect only
cookie attribute metadata in preview tests, and report any edge rewriting.
Never log cookie or session values.

Wait for the full HTTP response body before checking asynchronous session-store
renewal in PostgreSQL, not merely fetch's headers-ready resolution.

**Why:** Express-session can flush headers before store.touch finishes, causing
an immediate database assertion to intermittently see the previous expiry.

**How to apply:** Consume the response before querying stored expiry in session
integration tests. Do not compensate by weakening expiry consistency assertions.
