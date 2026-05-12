# PR Slack Bot

Slack slash command that lists open GitHub pull requests on demand with label filtering and per-channel default repo configuration.

## Usage

```
/prs                                    -- list PRs for the channel's default repo
/prs owner/repo                         -- list PRs for a specific repo
/prs label:bug                          -- filter by label
/prs owner/repo label:ready-for-review  -- combine repo and label filter
/prs state:closed                       -- filter by state (open, closed, all)
```

### Configuration

Set a default repo per channel so you can just type `/prs`:

```
/prs config repo owner/repo   -- set default repo for this channel
/prs config show               -- show current config
/prs config clear              -- remove default repo
```

**Output includes:** PR number with link, title, author, age, requested reviewers, and labels.

## How it works

1. User types `/prs` in Slack
2. Slack sends a POST request to the Cloudflare Worker
3. Worker resolves the repo (from args or channel default stored in KV)
4. Worker calls GitHub API to fetch matching PRs
5. Worker formats the response using Slack Block Kit and sends it back

## Setup (step by step)

### Step 1: Create a Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** > **From scratch**
3. Name it (e.g. "PR Bot") and select your workspace
4. Click **Create App**

### Step 2: Create a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up with email (free, no credit card required)

### Step 3: Create a Cloudflare API Token

The `wrangler login` OAuth flow can fail. Use an API token instead:

1. Go to https://dash.cloudflare.com/profile/api-tokens (My Profile > API Tokens)
2. Click **Create Token**
3. Use the **Edit Cloudflare Workers** template
4. Under **Account Resources**, select your account
5. Click **Continue to summary** > **Create Token**
6. Copy the token

### Step 4: Create the KV namespace

KV is Cloudflare's key-value store (free tier: 100k reads/day, 1k writes/day). It stores per-channel config.

```bash
cd ~/project/pr-slack-bot
export CLOUDFLARE_API_TOKEN=your_token_here
npx wrangler kv namespace create CONFIG
```

Copy the `id` from the output and paste it in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CONFIG"
id = "your-namespace-id-here"
```

### Step 5: Deploy the Worker

```bash
npx wrangler deploy
```

It will output your worker URL:

```
https://pr-slack-bot.your-subdomain.workers.dev
```

Verify it works:

```bash
curl https://pr-slack-bot.your-subdomain.workers.dev/health
```

Should return `ok`.

### Step 6: Add the Slack Signing Secret

1. In your Slack app settings, go to **Basic Information** > **App Credentials**
2. Click **Show** next to **Signing Secret** and copy it
3. In the terminal:

```bash
npx wrangler secret put SLACK_SIGNING_SECRET
```

Paste the signing secret when prompted.

### Step 7: Add GitHub Token (only needed for private repos)

For public repos, skip this step. GitHub allows 60 requests/hour without a token.

For private repos:

1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Click **Generate new token**
3. Set a name (e.g. "pr-slack-bot") and expiration
4. Under **Repository access**, select the repos you want to query
5. Under **Permissions**, grant **Pull requests** > Read
6. Click **Generate token** and copy it
7. In the terminal:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Paste the token when prompted. Secrets apply immediately, no restart needed.

### Step 8: Create the Slash Command

1. In your Slack app settings (https://api.slack.com/apps), select your app
2. Go to **Slash Commands** > **Create New Command**
3. Fill in:
   - **Command:** `/prs`
   - **Request URL:** `https://pr-slack-bot.your-subdomain.workers.dev/slack/prs`
   - **Short Description:** List open GitHub PRs
   - **Usage Hint:** `owner/repo [label:name] [state:open|closed|all]`
4. Click **Save**

### Step 9: Install the App

1. In Slack app settings, go to **Install App**
2. Click **Install to Workspace** (or **Reinstall** if already installed)
3. Click **Allow**

### Step 10: Configure and test

Set the default repo for your channel:

```
/prs config repo pmonfort/horus_qa
```

Then just type:

```
/prs
```

## Local development

```bash
npm install
npx wrangler dev
```

This starts a local dev server on port 8787. Use ngrok to expose it for Slack testing:

```bash
npx ngrok http 8787
```

Update the Slack slash command Request URL to `https://xxxx.ngrok-free.app/slack/prs`.

## Hosting

Hosted on **Cloudflare Workers** (free tier):
- 100,000 requests/day
- No credit card required
- No cold starts, always-on
- HTTPS included
- KV storage for per-channel config (100k reads/day, 1k writes/day)
- Secrets managed via `npx wrangler secret put <NAME>`

## Project structure

```
pr-slack-bot/
  src/worker.js      -- Cloudflare Worker
  index.js           -- Express server (local dev alternative)
  wrangler.toml      -- Cloudflare Worker config + KV binding
  package.json
```
