---
name: PR Slack Bot overview
description: Project purpose, tech stack, architecture, and deployment options
type: project
---

Slack slash command bot that lists open GitHub pull requests on demand with label filtering.

**Why:** No off-the-shelf Slack app (Axolo, GitHub for Slack, PullNotifier) supports on-demand PR listing with label filters. Axolo onboarding failed for personal GitHub accounts. Built as a custom solution.

**How to apply:** This is a standalone microservice, not part of stitch_bank. Lives at ~/project/pr-slack-bot.

## Tech Stack
- Node.js with Express 5
- @octokit/rest for GitHub API
- Slack slash command integration with signature verification

## Architecture
- Single endpoint: POST `/slack/prs` receives Slack slash commands
- Health check: GET `/health`
- Parses args: `owner/repo`, `label:name`, `state:open|closed|all`
- Calls GitHub Pulls API, formats response with links, authors, reviewers, labels, age

## Deployment
- **Koyeb** (recommended): always-on, free, no credit card
- **Render**: free, spins down after 15 min inactivity
- **Local dev**: ngrok to expose localhost:3333

## Required env vars
- `GITHUB_TOKEN` -- GitHub fine-grained PAT with pull request read access
- `SLACK_SIGNING_SECRET` -- from Slack app Basic Information
- `PORT` -- defaults to 3333
