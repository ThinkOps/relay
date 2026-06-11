const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runCli } = require("../src/cli");
const { createRelay } = require("../src/domain");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "relay-cli-test-"));
}

function runRelay(args, options = {}) {
  return execFileSync(process.execPath, ["bin/relay.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

async function captureStdout(callback) {
  const lines = [];
  const originalLog = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await callback();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

test("help explains the agent operating loop", async () => {
  const output = await captureStdout(() => runCli(["--help"], {}, process.cwd()));

  assert.match(output, /Agent contract:/);
  assert.match(output, /Agent loop:/);
  assert.match(output, /relay agent inbox --agent dev-agent --role developer --unread --json/);
  assert.match(output, /relay brief 12 --role developer --json/);
  assert.match(output, /relay card lint 12 --json/);
  assert.match(output, /relay agent ack 34 --agent dev-agent --role developer --json/);
  assert.match(output, /Prefer --json for machine-readable output/);
  assert.match(output, /RELAY_DB=\/path\/to\/control\/relay\.db/);
  assert.match(output, /RELAY_DATA_HOME=\/path\/to\/local\/data\/relay/);
});

test("claim prints the brief in human-readable mode", () => {
  const root = tempDir();
  const dbPath = path.join(root, ".relay", "relay.db");

  const app = createRelay({ dbPath, cwd: process.cwd() });
  app.createFeature({ name: "Login Revamp", actor: "pm-agent", role: "pm" });
  app.createProject({ feature: "Login Revamp", name: "Mobile App", actor: "admin", role: "admin" });
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Claim prints context",
    problemStatement: "Human CLI users need the same bounded context agents get through JSON.",
    acceptanceCriteria: "Claim output includes the card brief",
    definitionOfDone: "The terminal output starts from the brief instead of a raw object.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });
  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "admin", role: "admin" });
  app.close();

  const output = runRelay([
    "--db",
    dbPath,
    "claim",
    String(card.id),
    "--actor",
    "dev-agent",
    "--agent",
    "dev-agent",
    "--role",
    "developer",
  ]);

  assert.match(output, new RegExp(`#${card.id} Claim prints context`));
  assert.match(output, /Next action:/);
  assert.doesNotMatch(output, /brief: \[object Object\]/);
});

test("context CLI adds, lists, shows, and supersedes markdown bodies", () => {
  const root = tempDir();
  const dbPath = path.join(root, ".relay", "relay.db");
  const bodyPath = path.join(root, "notes.md");
  const handoffPath = path.join(root, "handoff.md");
  fs.writeFileSync(bodyPath, "## Backend changes\n- Added reset validation\n");
  fs.writeFileSync(handoffPath, "Reviewer should start with reset validation.\n");

  const app = createRelay({ dbPath, cwd: process.cwd() });
  app.createFeature({ name: "Login Revamp", actor: "pm-agent", role: "pm" });
  app.createProject({ feature: "Login Revamp", name: "Mobile App", actor: "admin", role: "admin" });
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Wire reset validation",
    problemStatement: "Reset validation needs implementation notes.",
    acceptanceCriteria: "Context CLI can write implementation notes",
    definitionOfDone: "List and show commands return the layer.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });
  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "admin", role: "admin" });
  app.close();

  const added = JSON.parse(
    runRelay([
      "--db",
      dbPath,
      "context",
      "add",
      "--card",
      String(card.id),
      "--type",
      "implementation_notes",
      "--title",
      "Backend changes",
      "--body-file",
      bodyPath,
      "--actor",
      "dev-agent",
      "--role",
      "developer",
      "--json",
    ]),
  );
  assert.equal(added.bodyMarkdown, "## Backend changes\n- Added reset validation");

  const active = JSON.parse(runRelay(["--db", dbPath, "context", "list", "--card", String(card.id), "--json"]));
  assert.deepEqual(
    active.map((layer) => layer.id),
    [added.id],
  );

  const replacement = JSON.parse(
    runRelay(
      [
        "--db",
        dbPath,
        "context",
        "supersede",
        String(added.id),
        "--title",
        "Updated backend changes",
        "--body",
        "-",
        "--actor",
        "dev-agent",
        "--role",
        "developer",
        "--json",
      ],
      { input: "## Updated\n- Added tests\n" },
    ),
  );
  assert.equal(replacement.supersedesId, added.id);
  assert.equal(replacement.bodyMarkdown, "## Updated\n- Added tests");

  const shown = JSON.parse(runRelay(["--db", dbPath, "context", "show", String(added.id), "--json"]));
  assert.equal(shown.supersededById, replacement.id);

  const all = JSON.parse(
    runRelay(["--db", dbPath, "context", "list", "--card", String(card.id), "--all", "--json"]),
  );
  assert.deepEqual(
    all.map((layer) => layer.id),
    [replacement.id, added.id],
  );

  const invalid = spawnSync(
    process.execPath,
    [
      "bin/relay.js",
      "--db",
      dbPath,
      "context",
      "add",
      "--card",
      String(card.id),
      "--type",
      "implementation_notes",
      "--title",
      "Invalid body source",
      "--body",
      "inline",
      "--body-file",
      bodyPath,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Exactly one of --body or --body-file is required/);

  const claimed = JSON.parse(
    runRelay([
      "--db",
      dbPath,
      "claim",
      String(card.id),
      "--actor",
      "dev-agent",
      "--agent",
      "dev-agent",
      "--role",
      "developer",
      "--json",
    ]),
  );
  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.brief.card.id, card.id);

  const moved = JSON.parse(
    runRelay([
      "--db",
      dbPath,
      "move",
      String(card.id),
      "review",
      "--actor",
      "dev-agent",
      "--role",
      "developer",
      "--handoff-file",
      handoffPath,
      "--json",
    ]),
  );
  assert.deepEqual(moved.warnings, []);

  const handoff = JSON.parse(
    runRelay([
      "--db",
      dbPath,
      "context",
      "list",
      "--card",
      String(card.id),
      "--type",
      "handoff_intent",
      "--json",
    ]),
  );
  assert.equal(handoff[0].bodyMarkdown, "Reviewer should start with reset validation.");

  const lint = JSON.parse(runRelay(["--db", dbPath, "card", "lint", String(card.id), "--json"]));
  assert.deepEqual(lint, []);
});
