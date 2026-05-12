import express from "express";
import crypto from "node:crypto";
import { Octokit } from "@octokit/rest";

const app = express();
const PORT = process.env.PORT || 3333;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

app.use(express.urlencoded({ extended: true, verify: storeRawBody }));

function storeRawBody(req, _res, buf) {
  req.rawBody = buf.toString();
}

function verifySlackSignature(req) {
  if (!SLACK_SIGNING_SECRET) return false;

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  const fiveMinutes = 5 * 60;
  if (Math.abs(Date.now() / 1000 - timestamp) > fiveMinutes) return false;

  const baseString = `v0:${timestamp}:${req.rawBody}`;
  const hash =
    "v0=" +
    crypto
      .createHmac("sha256", SLACK_SIGNING_SECRET)
      .update(baseString)
      .digest("hex");

  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseArgs(text) {
  const args = { owner: null, repo: null, labels: [], state: "open" };

  const parts = text.trim().split(/\s+/).filter(Boolean);

  for (const part of parts) {
    if (part.startsWith("label:")) {
      args.labels.push(part.slice(6));
    } else if (part.startsWith("state:")) {
      const val = part.slice(6);
      if (["open", "closed", "all"].includes(val)) args.state = val;
    } else if (part.includes("/")) {
      const [owner, repo] = part.split("/");
      args.owner = owner;
      args.repo = repo;
    } else {
      args.repo = part;
    }
  }

  return args;
}

function formatPR(pr) {
  const labels = pr.labels.map((l) => `\`${l.name}\``).join(" ");
  const age = Math.floor(
    (Date.now() - new Date(pr.created_at).getTime()) / 86400000,
  );
  const ageText = age === 0 ? "today" : age === 1 ? "1 day ago" : `${age}d ago`;
  const reviewers = (pr.requested_reviewers || [])
    .map((r) => r.login)
    .join(", ");
  const reviewerText = reviewers ? ` | reviewers: ${reviewers}` : "";

  return (
    `<${pr.html_url}|#${pr.number} ${pr.title}>\n` +
    `  by *${pr.user.login}* | ${ageText}${reviewerText}` +
    (labels ? ` | ${labels}` : "")
  );
}

async function fetchPRs({ owner, repo, labels, state }) {
  const params = { owner, repo, state, per_page: 30, sort: "updated" };
  if (labels.length > 0) params.labels = labels.join(",");

  const { data } = await octokit.pulls.list(params);
  return data;
}

app.post("/slack/prs", async (req, res) => {
  if (!verifySlackSignature(req)) {
    return res.status(401).send("Unauthorized");
  }

  const text = (req.body.text || "").trim();
  const args = parseArgs(text);

  if (!args.owner || !args.repo) {
    return res.json({
      response_type: "ephemeral",
      text:
        "*Usage:* `/prs owner/repo [label:name] [state:open|closed|all]`\n" +
        "*Examples:*\n" +
        "  `/prs pmonfort/horus_qa`\n" +
        "  `/prs pmonfort/horus_qa label:bug`\n" +
        "  `/prs pmonfort/horus_qa label:ready-for-review state:open`",
    });
  }

  try {
    const prs = await fetchPRs(args);

    if (prs.length === 0) {
      const labelInfo =
        args.labels.length > 0 ? ` with label(s): ${args.labels.join(", ")}` : "";
      return res.json({
        response_type: "in_channel",
        text: `No ${args.state} PRs found in *${args.owner}/${args.repo}*${labelInfo}.`,
      });
    }

    const header = args.labels.length > 0
      ? `*${args.state} PRs in ${args.owner}/${args.repo}* (label: ${args.labels.join(", ")})`
      : `*${args.state} PRs in ${args.owner}/${args.repo}*`;

    const prList = prs.map(formatPR).join("\n\n");

    return res.json({
      response_type: "in_channel",
      text: `${header}\n\n${prList}\n\n_${prs.length} PR(s) found_`,
    });
  } catch (err) {
    console.error("GitHub API error:", err.message);
    return res.json({
      response_type: "ephemeral",
      text: `Error fetching PRs: ${err.message}`,
    });
  }
});

app.get("/health", (_req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`PR Slack bot running on port ${PORT}`);
});
