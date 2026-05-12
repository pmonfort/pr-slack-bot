export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/slack/prs" && request.method === "POST") {
      return handleSlackCommand(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleSlackCommand(request, env) {
  const body = await request.text();
  const params = new URLSearchParams(body);

  if (!verifySlackSignature(request, body, env.SLACK_SIGNING_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const text = (params.get("text") || "").trim();
  const channelId = params.get("channel_id");

  if (text.startsWith("config")) {
    return handleConfig(text, channelId, env);
  }

  const format = await getFormat(channelId, env);
  const args = await resolveArgs(text, channelId, env);

  if (!args.owner || !args.repo) {
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [
        section("*Usage*"),
        section(
          "`/prs` -- list PRs for the default repo\n" +
            "`/prs owner/repo` -- list PRs for a specific repo\n" +
            "`/prs label:bug` -- filter by label\n" +
            "`/prs state:closed` -- filter by state",
        ),
        divider(),
        section("*Config*"),
        section(
          "`/prs config repo owner/repo` -- set default repo\n" +
            "`/prs config format detailed|compact|table` -- set display format\n" +
            "`/prs config show` -- show current config",
        ),
      ],
    });
  }

  try {
    const prs = await fetchPRs(args, env.GITHUB_TOKEN);
    let blocks;
    if (format === "compact") blocks = buildCompactBlocks(prs, args);
    else if (format === "table") blocks = buildTableBlocks(prs, args);
    else blocks = buildDetailedBlocks(prs, args);
    return jsonResponse({ response_type: "in_channel", blocks });
  } catch (err) {
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [section(`Error: ${err.message}`)],
    });
  }
}

async function handleConfig(text, channelId, env) {
  const parts = text.replace("config", "").trim().split(/\s+/).filter(Boolean);
  const subcommand = parts[0];

  if (subcommand === "repo" && parts[1]) {
    const repo = parts[1];
    if (!repo.includes("/")) {
      return jsonResponse({
        response_type: "ephemeral",
        blocks: [section("Format: `/prs config repo owner/repo`")],
      });
    }
    await env.CONFIG.put(`channel:${channelId}:repo`, repo);
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [
        section(`Default repo set to *${repo}*.`),
        context("Now you can just type `/prs` to list PRs."),
      ],
    });
  }

  if (subcommand === "format" && parts[1]) {
    const format = parts[1];
    if (!["detailed", "compact", "table"].includes(format)) {
      return jsonResponse({
        response_type: "ephemeral",
        blocks: [section("Format must be `detailed`, `compact`, or `table`.")],
      });
    }
    await env.CONFIG.put(`channel:${channelId}:format`, format);
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [section(`Format set to *${format}*.`)],
    });
  }

  if (subcommand === "show" || !subcommand) {
    const repo = await env.CONFIG.get(`channel:${channelId}:repo`);
    const format = await env.CONFIG.get(`channel:${channelId}:format`);
    const lines = [
      `*Default repo:* ${repo || "_not set_"}`,
      `*Format:* ${format || "detailed"}`,
    ];
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [section(lines.join("\n"))],
    });
  }

  if (subcommand === "clear") {
    await env.CONFIG.delete(`channel:${channelId}:repo`);
    await env.CONFIG.delete(`channel:${channelId}:format`);
    return jsonResponse({
      response_type: "ephemeral",
      blocks: [section("Config cleared for this channel.")],
    });
  }

  return jsonResponse({
    response_type: "ephemeral",
    blocks: [
      section("*Config commands*"),
      section(
        "`/prs config repo owner/repo` -- set default repo\n" +
          "`/prs config format detailed|compact|table` -- set display format\n" +
          "`/prs config show` -- show current config\n" +
          "`/prs config clear` -- reset all config",
      ),
    ],
  });
}

async function getFormat(channelId, env) {
  if (!env.CONFIG) return "detailed";
  return (await env.CONFIG.get(`channel:${channelId}:format`)) || "detailed";
}

async function resolveArgs(text, channelId, env) {
  const args = parseArgs(text);

  if (!args.owner && env.CONFIG) {
    const defaultRepo = await env.CONFIG.get(`channel:${channelId}:repo`);
    if (defaultRepo && defaultRepo.includes("/")) {
      const [owner, repo] = defaultRepo.split("/");
      args.owner = owner;
      args.repo = repo;
    }
  }

  return args;
}

function ageText(createdAt) {
  const days = Math.floor(
    (Date.now() - new Date(createdAt).getTime()) / 86400000,
  );
  if (days === 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function statusIcon(pr) {
  if (pr.draft) return ":pencil2: draft";
  return ":large_green_circle: open";
}

function labelTags(pr) {
  return pr.labels.map((l) => `\`${l.name}\``).join("  ");
}

function headerBlock(args, count) {
  const repoName = `${args.owner}/${args.repo}`;
  const repoUrl = `https://github.com/${args.owner}/${args.repo}/pulls`;
  const labelInfo =
    args.labels.length > 0
      ? `  :label: ${args.labels.join(", ")}`
      : "";
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: `${repoName} -- ${count} open PR(s)`,
    },
  };
}

function buildDetailedBlocks(prs, args) {
  if (prs.length === 0) {
    return [section(`No ${args.state} PRs found.`)];
  }

  const blocks = [headerBlock(args, prs.length), divider()];

  for (let i = 0; i < prs.length; i++) {
    const pr = prs[i];
    const labels = labelTags(pr);
    const age = ageText(pr.created_at);
    const status = statusIcon(pr);
    const reviewers = (pr.requested_reviewers || [])
      .map((r) => r.login)
      .join(", ");

    let details = `${status}  |  *${pr.user.login}*  |  ${age}`;
    if (reviewers) details += `  |  :eyes: ${reviewers}`;
    if (labels) details += `\n${labels}`;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${pr.html_url}|*#${pr.number}  ${pr.title}*>`,
      },
    });
    blocks.push(context(details));

    if (i < prs.length - 1) blocks.push(divider());
  }

  blocks.push(divider());
  blocks.push(
    context(
      `:github: <https://github.com/${args.owner}/${args.repo}/pulls|View all PRs on GitHub>  |  ${prs.length} result(s)`,
    ),
  );

  return blocks;
}

function buildCompactBlocks(prs, args) {
  if (prs.length === 0) {
    return [section(`No ${args.state} PRs found.`)];
  }

  const blocks = [headerBlock(args, prs.length), divider()];

  const header = "*Author*  |  *Pull Request*  |  *Age*  |  *Status*  |  *Labels*";
  const rows = [header];

  for (const pr of prs) {
    const labels = pr.labels.map((l) => `\`${l.name}\``).join(" ");
    const age = ageText(pr.created_at);
    const status = pr.draft ? ":pencil2: draft" : ":large_green_circle: open";

    let row = `${pr.user.login}  |  <${pr.html_url}|#${pr.number} ${pr.title}>  |  ${age}  |  ${status}  |  ${labels || "-"}`;
    rows.push(row);
  }

  blocks.push(section(rows.join("\n")));
  blocks.push(divider());
  blocks.push(
    context(
      `:github: <https://github.com/${args.owner}/${args.repo}/pulls|View all PRs on GitHub>  |  ${prs.length} result(s)`,
    ),
  );

  return blocks;
}

function buildTableBlocks(prs, args) {
  if (prs.length === 0) {
    return [section(`No ${args.state} PRs found.`)];
  }

  const blocks = [headerBlock(args, prs.length), divider()];

  const pad = (str, len) => {
    if (str.length > len - 3) return str.slice(0, len - 3) + "...";
    return str + " ".repeat(len - str.length);
  };
  const padExact = (str, len) => str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);

  const colAuthor = 20;
  const colTitle = 44;
  const colAge = 10;
  const colStatus = 10;

  let table = padExact("Author", colAuthor) + padExact("PR Title", colTitle) + padExact("Age", colAge) + padExact("Status", colStatus) + "Labels\n";
  table += "-".repeat(colAuthor + colTitle + colAge + colStatus + 20) + "\n";

  for (const pr of prs) {
    const labels = pr.labels.map((l) => l.name).join(", ");
    const age = ageText(pr.created_at);
    const status = pr.draft ? "draft" : "open";
    const title = `#${pr.number} ${pr.title}`;

    table += padExact(pr.user.login, colAuthor) + pad(title, colTitle) + padExact(age, colAge) + padExact(status, colStatus) + (labels || "-") + "\n";
  }

  blocks.push(section("```\n" + table + "```"));

  const links = prs
    .map((pr) => `<${pr.html_url}|#${pr.number}>`)
    .join("  ");
  blocks.push(context(`Open:  ${links}`));

  blocks.push(divider());
  blocks.push(
    context(
      `:github: <https://github.com/${args.owner}/${args.repo}/pulls|View all PRs on GitHub>  |  ${prs.length} result(s)`,
    ),
  );

  return blocks;
}

function section(text) {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function divider() {
  return { type: "divider" };
}

function context(text) {
  return {
    type: "context",
    elements: [{ type: "mrkdwn", text }],
  };
}

async function verifySlackSignature(request, body, secret) {
  if (!secret) return true;

  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  const fiveMinutes = 5 * 60;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMinutes)
    return false;

  const baseString = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(baseString),
  );
  const hash = "v0=" + bufToHex(sig);

  return hash === signature;
}

function bufToHex(buffer) {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseArgs(text) {
  const args = { owner: null, repo: null, labels: [], state: "open" };
  const parts = text.split(/\s+/).filter(Boolean);

  for (const part of parts) {
    if (part.startsWith("label:")) {
      args.labels.push(part.slice(6));
    } else if (part.startsWith("state:")) {
      args.state = part.slice(6);
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

async function fetchPRs({ owner, repo, labels, state }, token) {
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
  );
  url.searchParams.set("state", state);
  url.searchParams.set("per_page", "30");
  url.searchParams.set("sort", "updated");
  if (labels.length > 0) url.searchParams.set("labels", labels.join(","));

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "pr-slack-bot",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API ${response.status}: ${error}`);
  }

  return response.json();
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}
