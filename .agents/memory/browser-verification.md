---
name: Browser verification availability
description: Browser testing fallback when the documented testing worker is unavailable.
---

Do not assume the documented specialized testing worker is available in every task environment. In this environment its launch was rejected as an unknown kind; direct Playwright against the running development app worked.

**Why:** Interactive composer sizing and signed-in proposal approval cannot be established by a signed-out screenshot or prompt unit tests alone.

**How to apply:** If the specialized worker is unavailable, use a focused local browser check with a disposable account and clean up only its records. Leave production authentication intact.

Headless Chromium's mouse-based dragTo was unreliable on this tracker and hit unintended cards during board rerenders. Never run native drag tests on a board containing real records; filter to disposable work first. Explicitly targeted DataTransfer dragstart/dragover/drop events can check UI handlers and API persistence, but are not proof of physical mouse dragging. Distinguish the two in verification reports.

Layout overflow assertions should account for a one-CSS-pixel rounding difference.

**Why:** The mobile Settings browser check reported a scroll width one pixel larger than the viewport while no element extended beyond it by more than one pixel. Treating that rounding as a broken layout caused unnecessary retries.

**How to apply:** Inspect element bounds before changing UI solely to satisfy an integer-width assertion; reserve failures for meaningful overflow.

When checking a phone layout after starting a browser on desktop, set the intended sidebar state explicitly or reload at the phone width.

**Why:** Resizing a browser preserves mount-time desktop sidebar state, which can make a narrow-screen test measure an open desktop sidebar instead of the initial phone layout.

**How to apply:** Close the sidebar before testing the content controls, or navigate at the target viewport when testing initial mobile behavior. Do not hide a genuine content overflow by relaxing the width assertion.

For tests that deliberately cancel browser-back navigation, trigger history.back() without awaiting a navigation load event, then assert the route and draft remain intact.

**Why:** Playwright's goBack() can time out waiting for a load event precisely because the application's unsaved-draft guard successfully prevented navigation.

**How to apply:** Use a dialog dismissal handler plus history.back() in page evaluation for guard tests; use normal navigation waiting when navigation is meant to succeed.