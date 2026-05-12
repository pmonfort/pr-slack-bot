---
name: Project origin and context
description: Why this bot was created, Axolo issues, and alternatives evaluated
type: project
---

Created 2026-05-11 as a replacement for Axolo and other PR listing tools.

**Why:** User needed on-demand PR listing in Slack with label filters and clickable links. Evaluated these options:

1. **Axolo** -- onboarding failed on personal GitHub accounts (Step 2 redirect bug). Would have provided `/axolo open` and `/axolo me`
2. **GitHub for Slack** (official) -- only push notifications via `/github subscribe`, no on-demand listing command
3. **PullNotifier** -- notification-driven, no on-demand listing
4. **Pull Reminders / Pull Panda** -- deprecated/absorbed by GitHub

None provided on-demand listing with label filters, so we built a custom slash command bot.

**How to apply:** If the user asks about Slack PR integrations or Axolo alternatives, this is the solution that was built.
