---
name: Milestone sprint intent
description: Why milestone sprint defaults include newly created sprints without rescheduling tasks.
---

Milestones include every current and future sprint by default. Explicit unchecked choices remain excluded until checked again; changing milestone selections never reschedules its tasks.

**Why:** The user explicitly confirmed that new sprints should be selected for existing milestones, while keeping task sprint assignments independent. A fixed list of selected sprints would violate that future-sprint intent.

**How to apply:** Preserve these defaults in future milestone forms, integrations, and scheduling features. Do not infer task scheduling from a milestone's selected sprint labels.