# PR Slack Bot

Slack slash command that lists open GitHub pull requests on demand with label filtering.

## Usage

```
/prs owner/repo
/prs owner/repo label:bug
/prs owner/repo label:ready-for-review state:open
```

**Parameters:**
- `owner/repo` (required) -- GitHub repository
- `label:name` -- filter by label (can use multiple)
- `state:open|closed|all` -- PR state (default: open)

**Output includes:** PR title with link, author, age, requested reviewers, and labels.

## How it works

1. User types `/prs pmonfort/horus_qa` in Slack
2. Slack sends a POST request to the bot
3. Bot calls GitHub API to fetch matching PRs
4. Bot formats the response and sends it back to the Slack channel

## Setup

### 1. Create a GitHub Personal Access Token

1. Go to GitHub > Settings > Developer settings > Personal access tokens > Fine-grained tokens
2. Click "Generate new token"
3. Set a name (e.g. "pr-slack-bot") and expiration
4. Under "Repository access", select the repos you want to query
5. Under "Permissions", grant **Pull requests** read access
6. Copy the token

### 2. Create a Slack App

1. Go to https://api.slack.com/apps
2. Click "Create New App" > "From scratch"
3. Name it (e.g. "PR Bot") and select your workspace
4. Go to **Slash Commands** > "Create New Command":
   - Command: `/prs`
   - Request URL: `https://your-server-url/slack/prs` (set after deploying)
   - Short Description: "List open GitHub PRs"
   - Usage Hint: `owner/repo [label:name] [state:open|closed|all]`
5. Go to **Basic Information** > App Credentials, copy the **Signing Secret**
6. Go to **Install App** and install it to your workspace

### 3. Configure environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

```
GITHUB_TOKEN=ghp_your_token_here
SLACK_SIGNING_SECRET=your_signing_secret_here
PORT=3333
```

### 4. Run locally

```bash
npm install
npm run dev
```

To test locally, use ngrok to expose the server:

```bash
npx ngrok http 3333
```

Copy the ngrok URL and update the Slack slash command Request URL to `https://xxxx.ngrok-free.app/slack/prs`.

## Deploy to a free server

Two good free options: **Koyeb** (always-on) and **Render** (spins down after 15 min of inactivity).

---

### Option A: Koyeb (recommended, always-on)

Koyeb has a permanent free tier with no credit card required. The bot stays running 24/7 with no cold starts.

**Step 1: Create a GitHub repo**

```bash
cd pr-slack-bot
git init
git add -A
git commit -m "initial commit"
gh repo create pr-slack-bot --private --source=. --push
```

**Step 2: Sign up at Koyeb**

Go to https://www.koyeb.com and sign up with GitHub.

**Step 3: Create a new service**

1. Click "Create Web Service"
2. Select "GitHub" as the deployment method
3. Select your `pr-slack-bot` repository
4. Set the build and run commands:
   - Build command: `npm install`
   - Start command: `node index.js`
5. Set the port to `3333`
6. Add environment variables:
   - `GITHUB_TOKEN` = your token
   - `SLACK_SIGNING_SECRET` = your signing secret
   - `PORT` = 3333
7. Select the free instance type
8. Click "Deploy"

**Step 4: Update Slack**

Copy the URL Koyeb gives you (e.g. `https://pr-slack-bot-xxxx.koyeb.app`) and update the slash command Request URL in Slack to `https://pr-slack-bot-xxxx.koyeb.app/slack/prs`.

---

### Option B: Render (free, sleeps after 15 min)

Render has a permanent free tier. The service spins down after 15 minutes of inactivity. First request after spin-down takes ~30 seconds (Slack retries automatically, so this works fine).

**Step 1: Create a GitHub repo**

Same as Option A above.

**Step 2: Sign up at Render**

Go to https://render.com and sign up with GitHub.

**Step 3: Create a new Web Service**

1. Click "New" > "Web Service"
2. Connect your `pr-slack-bot` repository
3. Configure:
   - Name: `pr-slack-bot`
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `node index.js`
4. Select the "Free" plan
5. Add environment variables:
   - `GITHUB_TOKEN` = your token
   - `SLACK_SIGNING_SECRET` = your signing secret
   - `PORT` = 3333
6. Click "Create Web Service"

**Step 4: Update Slack**

Copy the URL Render gives you (e.g. `https://pr-slack-bot.onrender.com`) and update the slash command Request URL in Slack to `https://pr-slack-bot.onrender.com/slack/prs`.

---

## Verify

After deploying, check the health endpoint:

```
curl https://your-server-url/health
```

Then test in Slack:

```
/prs pmonfort/horus_qa
```
