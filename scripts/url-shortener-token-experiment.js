#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRelay } = require("../src/domain");

const USER_GOAL = `Build a very small URL shortener.

Team shape:
- one PM
- three developers
- one reviewer

Acceptance:
- POST /shorten accepts a valid URL and returns a short URL and slug.
- GET /:slug redirects to the original URL and increments click count.
- GET /api/:slug returns URL metadata and click count.
- Invalid URLs and missing slugs return useful JSON errors.
- Tests cover happy path, invalid URL, missing slug, and stats.
`;

const PM_PLAN = `PM plan:
Dev 1 owns the in-memory URL store, slug generation, validation, and metadata.
Dev 2 owns the HTTP server routes for shorten, redirect, and stats.
Dev 3 owns tests, README, and the package entry points.
Reviewer checks cross-file integration, acceptance criteria, and whether the implementation is understandable.
`;

const FEATURE_BRIEF = `Feature brief:
This is a deliberately small URL shortener. It is not a production service.
The goal is to coordinate several agent handoffs around one simple product slice.
Correctness matters more than scale: validate URLs, produce stable JSON errors, redirect known slugs, and track clicks.
`;

const PROJECT_MAP = `Project map:
- package.json defines the Node test command.
- src/store.js owns URL validation, slug creation, metadata, and click counting.
- src/server.js owns the HTTP routes and JSON helpers.
- test/url-shortener.test.js covers the public behavior using the built-in Node test runner and fetch.
- README.md explains how to run and use the tiny service.
Conventions: CommonJS, no runtime npm dependencies, built-in node:http, node:test for verification.
`;

const DEV_NOTES = [
  `Dev 1 implementation notes:
Added UrlStore with create, get, registerClick, stats, and list helpers.
Validation uses the URL constructor and only accepts http/https URLs.
Slug generation is deterministic enough for tests and avoids collisions.
The store keeps createdAt and click count so stats can be returned without reading server internals.
Tradeoff: this is memory-only; persistence is out of scope for the experiment.
`,
  `Dev 2 implementation notes:
Added createServer with POST /shorten, GET /:slug, and GET /api/:slug.
POST /shorten parses JSON and returns 201 with slug, url, and shortUrl.
Redirect increments click count before returning 302 Location.
Missing slugs return 404 JSON instead of throwing.
Tradeoff: the server accepts a configurable baseUrl instead of inferring public host headers.
`,
  `Dev 3 implementation notes:
Added node:test coverage for shorten, redirect, stats, invalid URL, and missing slug.
Added README with run commands and sample curl calls.
Kept tests dependency-free and started the server on an ephemeral local port.
Tradeoff: tests assert behavior, not implementation details, so store internals can change later.
`,
];

const HUMAN_SUMMARIES = [
  `Goal:
Create the data model for a tiny URL shortener.

What changed:
- Added an in-memory store for long URLs, slugs, timestamps, and click counts.
- Added URL validation for http/https inputs.
- Added deterministic slug creation with collision handling.

Previous blockers:
None.

Claimed fixes:
- The store can create, read, count, and report URL metadata.

Remaining risks:
- Data is memory-only and resets on process restart; persistence is out of scope.

Evidence:
Store behavior is exercised through the HTTP tests in the final slice.
`,
  `Goal:
Expose the URL shortener through a tiny HTTP API.

What changed:
- Added POST /shorten for creating short links.
- Added GET /:slug for redirects.
- Added GET /api/:slug for metadata and click counts.
- Added JSON error responses for invalid input and missing slugs.

Previous blockers:
None.

Claimed fixes:
- The route layer uses the store instead of duplicating URL logic.

Remaining risks:
- No auth, persistence, rate limits, or custom domains; all are out of scope.

Evidence:
Route behavior is covered by the final node:test suite.
`,
  `Goal:
Make the tiny URL shortener testable and runnable by a human.

What changed:
- Added integration tests over the public HTTP API.
- Added README usage notes.
- Added package metadata and test command.

Previous blockers:
None.

Claimed fixes:
- Happy path, invalid URL, missing slug, redirect, and stats are covered.

Remaining risks:
- This remains an experiment app, not a deployable service.

Evidence:
node --test test/url-shortener.test.js passes.
`,
];

function main() {
  const outRoot = outputRoot();
  const baselineDir = path.join(outRoot, "baseline-group-url-shortener");
  const relayDir = path.join(outRoot, "relay-group-url-shortener");
  fs.mkdirSync(outRoot, { recursive: true });

  writeUrlShortener(baselineDir);
  writeUrlShortener(relayDir);
  runUrlShortenerTests(baselineDir);
  runUrlShortenerTests(relayDir);

  const relayDb = path.join(outRoot, "relay-control", "relay.db");
  const seeded = seedRelay(relayDb, relayDir);
  const rows = buildMeasurementRows(seeded);
  const totals = summarize(rows);

  writeReport(outRoot, rows, totals);
  printReport(outRoot, rows, totals);
}

function outputRoot() {
  const explicit = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "";
  if (explicit) return path.resolve(explicit);
  return fs.mkdtempSync(path.join(os.tmpdir(), "relay-url-shortener-token-study-"));
}

function writeUrlShortener(dir) {
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  writeFile(dir, "package.json", JSON.stringify(packageJson(), null, 2) + "\n");
  writeFile(dir, "src/store.js", storeSource());
  writeFile(dir, "src/server.js", serverSource());
  writeFile(dir, "test/url-shortener.test.js", testSource());
  writeFile(dir, "README.md", readmeSource());
}

function writeFile(root, relativePath, body) {
  fs.writeFileSync(path.join(root, relativePath), body);
}

function runUrlShortenerTests(dir) {
  execFileSync(process.execPath, ["--test", path.join(dir, "test", "url-shortener.test.js")], {
    cwd: dir,
    stdio: "pipe",
  });
}

function seedRelay(dbPath, cwd) {
  const app = createRelay({ dbPath, cwd });
  app.createFeature({
    name: "URL Shortener Experiment",
    summary: "Compare raw transcript handoffs with Relay bounded briefs.",
    actor: "pm-agent",
    role: "pm",
  });
  app.createProject({
    feature: "URL Shortener Experiment",
    name: "Tiny URL Shortener",
    description: "No-dependency Node URL shortener built by a small multi-agent team.",
    actor: "admin",
    role: "admin",
  });
  app.addContextLayer({
    feature: "URL Shortener Experiment",
    type: "feature_brief",
    title: "URL shortener feature brief",
    body: FEATURE_BRIEF,
    actor: "pm-agent",
    role: "pm",
  });
  app.addContextLayer({
    project: "URL Shortener Experiment:Tiny URL Shortener",
    type: "project_map",
    title: "Tiny URL shortener project map",
    body: PROJECT_MAP,
    actor: "pm-agent",
    role: "pm",
  });

  const cards = cardInputs().map((input) => {
    const card = app.createCard({
      ...input,
      project: "Tiny URL Shortener",
      feature: "URL Shortener Experiment",
      targetRepo: "local-url-shortener",
      expectedRole: "developer",
      riskLevel: "low",
      storyPoints: 1,
      sprint: "Token Study",
      actor: "pm-agent",
      role: "pm",
    });
    app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
    app.approveCard(card.id, { actor: "admin", role: "admin" });
    return card;
  });

  cards.forEach((card, index) => {
    const agent = `dev-${index + 1}`;
    app.claimCard(card.id, { actor: agent, agent, role: "developer" });
    app.addNote(card.id, {
      actor: agent,
      role: "developer",
      message: verboseProgressNote(index),
    });
    app.addContextLayer({
      card: card.id,
      type: "implementation_notes",
      title: `Dev ${index + 1} implementation notes`,
      body: DEV_NOTES[index],
      actor: agent,
      role: "developer",
    });
    app.moveCard(card.id, {
      actor: agent,
      role: "developer",
      status: "review",
      handoff: `Reviewer should verify card ${card.id} against acceptance criteria and the public API behavior.`,
      humanSummary: HUMAN_SUMMARIES[index],
    });
  });

  const result = {
    cards: cards.map((card) => app.getCard(card.id)),
    devBriefs: cards.map((card) => app.briefCard(card.id, { role: "developer" })),
    reviewerBriefs: cards.map((card) => app.briefCard(card.id, { role: "reviewer" })),
  };
  app.close();
  return result;
}

function cardInputs() {
  return [
    {
      title: "Implement the URL store",
      userStory: "As the route layer, I need a tiny store so short links can be created and resolved.",
      problemStatement: "The app has no place to validate URLs, assign slugs, or count clicks. Without a store, every route would duplicate state logic.",
      acceptanceCriteria: [
        "A valid http/https URL can be saved with a generated slug.",
        "An invalid URL is rejected.",
        "Stats include long URL, slug, created timestamp, and click count.",
      ],
      definitionOfDone: "Store behavior is covered through integration tests.",
    },
    {
      title: "Expose shorten and redirect routes",
      userStory: "As a user, I want to create and open short links so the service is usable.",
      problemStatement: "The store is not reachable over HTTP. Users need a create route, a redirect route, and a metadata route.",
      acceptanceCriteria: [
        "POST /shorten creates a short link for a valid URL.",
        "GET /:slug redirects and increments click count.",
        "GET /api/:slug returns metadata.",
        "Missing slugs return JSON 404 errors.",
      ],
      definitionOfDone: "HTTP behavior is covered by node:test.",
    },
    {
      title: "Add tests and usage docs",
      userStory: "As a reviewer, I want a runnable test suite and README so I can verify the app quickly.",
      problemStatement: "The app needs proof that the API works and instructions a human can follow. Without tests and docs, review depends on reading implementation details.",
      acceptanceCriteria: [
        "Tests cover create, redirect, stats, invalid URL, and missing slug.",
        "README explains how to run tests and start the server.",
        "No runtime npm dependencies are required.",
      ],
      definitionOfDone: "node --test passes and README includes sample calls.",
    },
  ];
}

function verboseProgressNote(index) {
  return `## Progress from dev-${index + 1}

I read the PM plan, the acceptance criteria, and the current project files. I checked how the other slices are expected to interact, then implemented my owned part without changing unrelated files.

Detailed observations:
- The app should stay dependency-free because the experiment is about coordination overhead, not framework setup.
- Each slice should be reviewable on its own, but the reviewer should still be able to verify the end-to-end behavior.
- I avoided production features such as persistence, auth, rate limits, custom domains, and analytics export.
- I left enough names and structure for the next role to inspect the flow quickly.

${DEV_NOTES[index]}`;
}

function buildMeasurementRows(seeded) {
  const repoSnapshot = readRepoSnapshot();
  const rawTranscript = seeded.cards
    .map((card) => {
      return `# Card ${card.id}: ${card.title}
${JSON.stringify(card, null, 2)}`;
    })
    .join("\n\n");

  return [
    row("pm", baselinePmPacket(), relayPmPacket()),
    row(
      "dev-1",
      baselineDevPacket("Dev 1", seeded.cards[0], rawTranscript, repoSnapshot),
      relayDevPacket("Dev 1", seeded.devBriefs[0]),
    ),
    row(
      "dev-2",
      baselineDevPacket("Dev 2", seeded.cards[1], rawTranscript, repoSnapshot),
      relayDevPacket("Dev 2", seeded.devBriefs[1]),
    ),
    row(
      "dev-3",
      baselineDevPacket("Dev 3", seeded.cards[2], rawTranscript, repoSnapshot),
      relayDevPacket("Dev 3", seeded.devBriefs[2]),
    ),
    row(
      "reviewer",
      baselineReviewerPacket(seeded.cards, rawTranscript, repoSnapshot),
      relayReviewerPacket(seeded.reviewerBriefs),
    ),
  ];
}

function row(role, baseline, relay) {
  const baselineTokens = estimateTokens(baseline);
  const relayTokens = estimateTokens(relay);
  return {
    role,
    baselineChars: baseline.length,
    baselineTokens,
    relayChars: relay.length,
    relayTokens,
    savedTokens: baselineTokens - relayTokens,
    savedPercent: percent(baselineTokens - relayTokens, baselineTokens),
  };
}

function baselinePmPacket() {
  return `You are the PM agent. Create the implementation plan and hand it to three devs and one reviewer.

${USER_GOAL}`;
}

function relayPmPacket() {
  return `You are the PM agent working in Relay. Create scoped cards and context layers.

${USER_GOAL}`;
}

function baselineDevPacket(label, card, rawTranscript, repoSnapshot) {
  return `You are ${label} in the raw-transcript group.

You do not have Relay briefs or context layers. Read the full project transcript and repo snapshot before working.

Current card:
${JSON.stringify(card, null, 2)}

Full accumulated transcript:
${rawTranscript}

Repo snapshot:
${repoSnapshot}`;
}

function relayDevPacket(label, brief) {
  return `You are ${label} in the Relay group.

Use the bounded Relay brief as your starting context. Read the referenced layers first and inspect code only where needed.

Relay brief:
${JSON.stringify(brief, null, 2)}`;
}

function baselineReviewerPacket(cards, rawTranscript, repoSnapshot) {
  return `You are the reviewer in the raw-transcript group.

Review all three URL shortener slices. Read the complete accumulated transcript and repo snapshot before deciding whether to approve.

Cards:
${JSON.stringify(cards, null, 2)}

Full accumulated transcript:
${rawTranscript}

Repo snapshot:
${repoSnapshot}`;
}

function relayReviewerPacket(briefs) {
  return `You are the reviewer in the Relay group.

Review the three cards using bounded Relay briefs, human review summaries, implementation_notes, and recent events.

Relay reviewer briefs:
${JSON.stringify(briefs, null, 2)}`;
}

function readRepoSnapshot() {
  return [
    ["package.json", JSON.stringify(packageJson(), null, 2)],
    ["src/store.js", storeSource()],
    ["src/server.js", serverSource()],
    ["test/url-shortener.test.js", testSource()],
    ["README.md", readmeSource()],
  ]
    .map(([name, body]) => `## ${name}\n\n${body}`)
    .join("\n\n");
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function summarize(rows) {
  const baselineTokens = rows.reduce((sum, item) => sum + item.baselineTokens, 0);
  const relayTokens = rows.reduce((sum, item) => sum + item.relayTokens, 0);
  return {
    baselineTokens,
    relayTokens,
    savedTokens: baselineTokens - relayTokens,
    savedPercent: percent(baselineTokens - relayTokens, baselineTokens),
  };
}

function percent(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function writeReport(outRoot, rows, totals) {
  const report = [
    "# URL Shortener Relay Token Study",
    "",
    "This is an estimated context-token study, not exact billable token telemetry.",
    "Estimator: `ceil(character_count / 4)` for the context packet each role would receive.",
    "",
    markdownTable(rows),
    "",
    `Baseline total: ${totals.baselineTokens} estimated tokens`,
    `Relay total: ${totals.relayTokens} estimated tokens`,
    `Estimated savings: ${totals.savedTokens} tokens (${totals.savedPercent}%)`,
    "",
    "Generated app directories:",
    `- ${path.join(outRoot, "baseline-group-url-shortener")}`,
    `- ${path.join(outRoot, "relay-group-url-shortener")}`,
    "",
    "Both generated apps passed `node --test test/url-shortener.test.js`.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(outRoot, "REPORT.md"), report);
}

function printReport(outRoot, rows, totals) {
  console.log("URL Shortener Relay Token Study");
  console.log("");
  console.log("Exact per-agent token telemetry was not available, so this uses ceil(chars / 4).");
  console.log(markdownTable(rows));
  console.log("");
  console.log(`Baseline total: ${totals.baselineTokens} estimated tokens`);
  console.log(`Relay total: ${totals.relayTokens} estimated tokens`);
  console.log(`Estimated savings: ${totals.savedTokens} tokens (${totals.savedPercent}%)`);
  console.log("");
  console.log(`Artifacts: ${outRoot}`);
  console.log(`Report: ${path.join(outRoot, "REPORT.md")}`);
}

function markdownTable(rows) {
  const lines = [
    "| Role | Raw transcript est. tokens | Relay brief est. tokens | Saved | Saved % |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const item of rows) {
    lines.push(
      `| ${item.role} | ${item.baselineTokens} | ${item.relayTokens} | ${item.savedTokens} | ${item.savedPercent}% |`,
    );
  }
  return lines.join("\n");
}

function packageJson() {
  return {
    name: "url-shortener-token-study",
    version: "0.0.0",
    private: true,
    type: "commonjs",
    scripts: {
      test: "node --test test/url-shortener.test.js",
      start: "node src/server.js",
    },
  };
}

function storeSource() {
  return `class UrlStore {
  constructor() {
    this.urls = new Map();
    this.counter = 0;
  }

  create(longUrl, requestedSlug = "") {
    const url = normalizeUrl(longUrl);
    const slug = requestedSlug ? normalizeSlug(requestedSlug) : this.nextSlug();
    if (this.urls.has(slug)) {
      const error = new Error("Slug already exists.");
      error.code = "slug_exists";
      throw error;
    }
    const record = {
      slug,
      url,
      clicks: 0,
      createdAt: new Date().toISOString(),
    };
    this.urls.set(slug, record);
    return { ...record };
  }

  get(slug) {
    const record = this.urls.get(String(slug || ""));
    return record ? { ...record } : null;
  }

  registerClick(slug) {
    const record = this.urls.get(String(slug || ""));
    if (!record) return null;
    record.clicks += 1;
    return { ...record };
  }

  stats(slug) {
    return this.get(slug);
  }

  nextSlug() {
    this.counter += 1;
    return this.counter.toString(36).padStart(4, "0");
  }
}

function normalizeUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    const error = new Error("A valid http or https URL is required.");
    error.code = "invalid_url";
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("A valid http or https URL is required.");
    error.code = "invalid_url";
    throw error;
  }
  return parsed.toString();
}

function normalizeSlug(value) {
  const slug = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(slug)) {
    const error = new Error("Slug must be 3-32 URL-safe characters.");
    error.code = "invalid_slug";
    throw error;
  }
  return slug;
}

module.exports = {
  UrlStore,
};
`;
}

function serverSource() {
  return `const http = require("node:http");
const { UrlStore } = require("./store");

function createServer(options = {}) {
  const store = options.store || new UrlStore();
  const baseUrl = options.baseUrl || "http://localhost:3000";

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, baseUrl);

      if (request.method === "POST" && url.pathname === "/shorten") {
        const body = await readJson(request);
        const record = store.create(body.url, body.slug);
        sendJson(response, 201, {
          slug: record.slug,
          url: record.url,
          shortUrl: new URL(\`/\${record.slug}\`, baseUrl).toString(),
        });
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/api/")) {
        const slug = decodeURIComponent(url.pathname.slice("/api/".length));
        const record = store.stats(slug);
        if (!record) {
          sendJson(response, 404, { error: "Short URL not found." });
          return;
        }
        sendJson(response, 200, record);
        return;
      }

      if (request.method === "GET" && url.pathname !== "/") {
        const slug = decodeURIComponent(url.pathname.slice(1));
        const record = store.registerClick(slug);
        if (!record) {
          sendJson(response, 404, { error: "Short URL not found." });
          return;
        }
        response.writeHead(302, { Location: record.url });
        response.end();
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      const status = ["invalid_url", "invalid_slug", "slug_exists"].includes(error.code) ? 400 : 500;
      sendJson(response, status, { error: error.message });
    }
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Request body too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Request body must be JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

if (require.main === module) {
  const server = createServer();
  server.listen(3000, "127.0.0.1", () => {
    console.log("URL shortener listening on http://127.0.0.1:3000");
  });
}

module.exports = {
  createServer,
};
`;
}

function testSource() {
  return `const assert = require("node:assert/strict");
const test = require("node:test");
const { createServer } = require("../src/server");

function listen() {
  const server = createServer({ baseUrl: "http://127.0.0.1:0" });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: \`http://127.0.0.1:\${port}\` });
    });
  });
}

test("shortens, redirects, and reports stats", async () => {
  const { server, baseUrl } = await listen();
  try {
    const created = await fetch(\`\${baseUrl}/shorten\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/path" }),
    });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.slug, "0001");
    assert.equal(body.url, "https://example.com/path");

    const redirected = await fetch(\`\${baseUrl}/\${body.slug}\`, { redirect: "manual" });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get("location"), "https://example.com/path");

    const stats = await fetch(\`\${baseUrl}/api/\${body.slug}\`);
    assert.equal(stats.status, 200);
    const statsBody = await stats.json();
    assert.equal(statsBody.clicks, 1);
  } finally {
    server.close();
  }
});

test("rejects invalid URLs", async () => {
  const { server, baseUrl } = await listen();
  try {
    const response = await fetch(\`\${baseUrl}/shorten\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "ftp://example.com/file" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /http or https/);
  } finally {
    server.close();
  }
});

test("returns useful JSON for missing slugs", async () => {
  const { server, baseUrl } = await listen();
  try {
    const response = await fetch(\`\${baseUrl}/missing\`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Short URL not found." });
  } finally {
    server.close();
  }
});
`;
}

function readmeSource() {
  return `# URL Shortener Token Study App

Tiny dependency-free Node URL shortener used by the Relay token experiment.

## Run

\`\`\`bash
npm test
npm start
\`\`\`

## API

\`\`\`bash
curl -X POST http://127.0.0.1:3000/shorten \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://example.com/path"}'

curl -i http://127.0.0.1:3000/0001
curl http://127.0.0.1:3000/api/0001
\`\`\`

This app is intentionally memory-only.
`;
}

main();
