---
name: Team scope intent
description: Product boundaries for teams, membership, and shared tracker features.
---

Teams are an organizational filter, not an authorization boundary. Users must retain authenticated access to every project and task regardless of team membership. Shared posts, reflections, and the current sprint remain tracker-wide.

**Why:** The user explicitly requested self-service single membership and project grouping, without owners, invitations, approvals, private projects, or same-team assignee restrictions.

**How to apply:** Future team features must not introduce team-dependent access checks or silently reinterpret global sprint/feed/reflection data as team-specific. Ask before expanding these product boundaries.

Chat should automatically receive current-sprint plans for the user's team projects on their first question, while read tools remain available for sprint plans and overviews of every project.

**Why:** The user explicitly requested team-specific starting context and project-wide read access for any user; personalization must not become an access restriction.

**How to apply:** Use team membership to choose automatic context only. Do not require same-team membership for explicit project overview or sprint-plan lookups.

Refresh automatic chat context on follow-up questions rather than retaining a permanent first-message snapshot.

**Why:** Team membership, the shared current sprint, and saved plans can change during a chat. A snapshot would keep giving outdated priorities despite newer saved work.

**How to apply:** Keep automatic context bounded and explicitly disclose omissions; preserve targeted, project-wide reads as the way to retrieve more detail. Missing current plans must not fall back to older sprint plans.