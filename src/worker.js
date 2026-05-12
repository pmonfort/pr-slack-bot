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
            "`/prs config format detailed|compact` -- set display format\n" +
            "`/prs config show` -- show current config",
        ),
      ],
    });
  }

  try {
    const prs = await fetchPRs(args, env.GITHUB_TOKEN);
    const blocks =
      format === "compact"
        ? buildCompactBlocks(prs, args)
        : buildDetailedBlocks(prs, args);
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
    if (format !== "detailed" && format !== "compact") {
      return jsonResponse({
        response_type: "ephemeral",
        blocks: [section("Format must be `detailed` or `compact`.")],
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
          "`/prs config format detailed|compact` -- set display format\n" +
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

function buildDetailedBlocks(prs, args) {
  const repoName = `${args.owner}/${args.repo}`;
  const labelInfo =
    args.labels.length > 0 ? ` | label: ${args.labels.join(", ")}` : "";
  const blocks = [];

  if (prs.length === 0) {
    blocks.push(section(`No ${args.state} PRs in *${repoName}*${labelInfo}.`));
    return blocks;
  }

  blocks.push(
    section(`*${repoName}* -- ${prs.length} open PR(s)${labelInfo}`),
  );
  blocks.push(divider());

  for (const pr of prs) {
    const labels = pr.labels.map((l) => `\`${l.name}\``).join("  ");
    const age = Math.floor(
      (Date.now() - new Date(pr.created_at).getTime()) / 86400000,
    );
    const ageText =
      age === 0 ? "today" : age === 1 ? "1d ago" : `${age}d ago`;
    const reviewers = (pr.requested_reviewers || [])
      .map((r) => r.login)
      .join(", ");

    let meta = `by *${pr.user.login}*  |  ${ageText}`;
    if (reviewers) meta += `  |  reviewers: ${reviewers}`;
    if (labels) meta += `  |  ${labels}`;

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${pr.html_url}|*#${pr.number}*  ${pr.title}>\n${meta}`,
      },
    });
  }

  blocks.push(divider());
  blocks.push(context(`${prs.length} PR(s) found`));

  return blocks;
}

function buildCompactBlocks(prs, args) {
  const repoName = `${args.owner}/${args.repo}`;
  const labelInfo =
    args.labels.length > 0 ? ` | label: ${args.labels.join(", ")}` : "";

  if (prs.length === 0) {
    return [section(`No ${args.state} PRs in *${repoName}*${labelInfo}.`)];
  }

  const lines = prs.map((pr) => {
    const labels = pr.labels.map((l) => `\`${l.name}\``).join(" ");
    const age = Math.floor(
      (Date.now() - new Date(pr.created_at).getTime()) / 86400000,
    );
    const ageText =
      age === 0 ? "today" : age === 1 ? "1d" : `${age}d`;
    const status = pr.draft ? "draft" : "open";

    let line = `${pr.user.login}  |  <${pr.html_url}|${pr.title}>  |  ${ageText}  |  ${status}`;
    if (labels) line += `  |  ${labels}`;
    return line;
  });

  return [
    section(`*${repoName}* -- ${prs.length} PR(s)${labelInfo}`),
    divider(),
    section(lines.join("\n")),
    divider(),
    context(`${prs.length} PR(s)`),
  ];
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
