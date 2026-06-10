const fs = require("node:fs");
const { CARD_STATUSES } = require("./constants");
const { createMistri } = require("./domain");
const { requireWorkspace, workspaceForInit } = require("./paths");

async function runCli(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const parsed = parseArgv(argv);
  const [area, action, ...rest] = parsed.positionals;

  if (!area || area === "help" || parsed.flags.help) {
    printHelp();
    return;
  }

  if (area === "init") {
    const workspace = workspaceForInit(cwd);
    fs.mkdirSync(workspace.mistriDir, { recursive: true });
    const app = createMistri({ dbPath: workspace.dbPath, cwd });
    app.close();
    print({ message: `Initialized Mistri at ${workspace.dbPath}` }, parsed.flags.json);
    return;
  }

  if (area === "ui") {
    throw new Error("`mistri ui` is coming in the next commit.");
  }

  const workspace = requireWorkspace(cwd);
  const app = createMistri({ dbPath: workspace.dbPath, cwd });

  try {
    const result = dispatch(app, env, parsed, area, action, rest);
    if (result !== undefined) print(result, parsed.flags.json);
  } finally {
    app.close();
  }
}

function dispatch(app, env, parsed, area, action, rest) {
  const flags = parsed.flags;
  const actor = flags.actor || env.USER || "unknown";

  if (area === "project") {
    if (action === "create") {
      return app.createProject({
        name: one(rest, "Project name"),
        description: flags.description,
        actor,
        role: flags.role || "admin",
      });
    }

    if (action === "list") {
      return app.listProjects();
    }
  }

  if (area === "feature") {
    if (action === "create") {
      return app.createFeature({
        project: requiredFlag(flags, "project"),
        name: one(rest, "Feature name"),
        summary: flags.summary,
        actor,
        role: flags.role || "pm",
      });
    }

    if (action === "list") {
      const project = requiredFlag(flags, "project");
      const found = app.listProjects().find((item) => item.name === project);
      if (!found) throw new Error(`Project not found: ${project}`);
      return app.listFeatures(found.id);
    }
  }

  if (area === "card") {
    if (action === "create") {
      return app.createCard({
        project: requiredFlag(flags, "project"),
        feature: requiredFlag(flags, "feature"),
        title: requiredFlag(flags, "title"),
        problemStatement: requiredFlag(flags, "problem"),
        acceptanceCriteria: flags.ac || flags.acceptance,
        definitionOfDone: requiredFlag(flags, "done"),
        targetRepo: flags.repo,
        expectedRole: flags.expectedRole || flags.role || "developer",
        riskLevel: flags.risk || "medium",
        priority: flags.priority,
        actor,
        role: flags.createdByRole || "pm",
      });
    }

    if (action === "submit") {
      return app.submitCard(one(rest, "Card id"), { actor, role: flags.role || "pm" });
    }

    if (action === "show") {
      return app.getCard(one(rest, "Card id"));
    }

    if (action === "list") {
      return app.listCards({
        status: flags.status,
        approvalStatus: flags.approval,
      });
    }
  }

  if (area === "admin") {
    const id = one(rest, "Card id");
    const input = { actor, role: "admin", reason: flags.reason, message: flags.message };

    if (action === "approve") return app.approveCard(id, input);
    if (action === "reject") return app.rejectCard(id, input);
    if (action === "changes") return app.requestChanges(id, input);
    if (action === "pause") return app.pauseCard(id, input);
    if (action === "cancel") return app.cancelCard(id, input);
    if (action === "done") return app.completeCard(id, input);
  }

  if (area === "claim") {
    return app.claimCard(action, {
      actor,
      role: requiredFlag(flags, "role"),
      agent: flags.agent || actor,
    });
  }

  if (area === "move") {
    return app.moveCard(action, {
      actor,
      role: requiredFlag(flags, "role"),
      status: one(rest, "Status"),
    });
  }

  if (area === "note") {
    return app.addNote(action, {
      actor,
      role: flags.role || "developer",
      message: one(rest, "Note"),
    });
  }

  if (area === "link") {
    return app.linkCard(action, {
      actor,
      role: flags.role || "developer",
      branch: flags.branch,
      commitSha: flags.commit || flags.sha,
      prUrl: flags.pr,
    });
  }

  if (area === "board") {
    return app.board();
  }

  throw new Error(`Unknown command. Run \`mistri help\` for usage.`);
}

function parseArgv(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token.startsWith("--")) {
      const raw = token.slice(2);
      const [key, inlineValue] = raw.split("=", 2);
      const next = argv[index + 1];
      const value =
        inlineValue !== undefined ? inlineValue : next && !next.startsWith("--") ? argv[++index] : true;

      if (flags[key] === undefined) {
        flags[key] = value;
      } else if (Array.isArray(flags[key])) {
        flags[key].push(value);
      } else {
        flags[key] = [flags[key], value];
      }
    } else {
      positionals.push(token);
    }
  }

  return { flags, positionals };
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    printList(value);
    return;
  }

  if (value && value.events) {
    printCard(value);
    return;
  }

  if (value && isBoard(value)) {
    printBoard(value);
    return;
  }

  if (value && value.message) {
    console.log(value.message);
    return;
  }

  console.log(formatObject(value));
}

function printList(items) {
  if (items.length === 0) {
    console.log("No records found.");
    return;
  }

  for (const item of items) {
    console.log(formatObject(item));
  }
}

function printCard(card) {
  console.log(formatObject(stripEvents(card)));
  if (card.events.length > 0) {
    console.log("");
    console.log("Events:");
    for (const event of card.events) {
      console.log(`- ${event.createdAt} ${event.role}:${event.actor} ${event.action} ${event.message}`);
    }
  }
}

function printBoard(board) {
  for (const status of CARD_STATUSES) {
    const cards = board[status] || [];
    console.log(`${status} (${cards.length})`);
    for (const card of cards) {
      console.log(`  #${card.id} P${card.priority} ${card.title} [${card.projectName}/${card.featureName}]`);
    }
  }
}

function formatObject(value) {
  if (!value || typeof value !== "object") return String(value);

  const pairs = Object.entries(value)
    .filter(([, entry]) => entry !== undefined && entry !== "")
    .map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.join("; ") : entry}`);

  return pairs.join("\n");
}

function stripEvents(card) {
  const copy = { ...card };
  delete copy.events;
  return copy;
}

function isBoard(value) {
  return CARD_STATUSES.some((status) => Array.isArray(value[status]));
}

function one(values, label) {
  if (!values || values.length === 0) throw new Error(`${label} is required.`);
  return values.join(" ").trim();
}

function requiredFlag(flags, key) {
  if (flags[key] === undefined || flags[key] === true || String(flags[key]).trim() === "") {
    throw new Error(`--${key} is required.`);
  }
  return flags[key];
}

function printHelp() {
  console.log(`Mistri

Usage:
  mistri init
  mistri project create "Mobile App" [--description "..."]
  mistri project list
  mistri feature create "Login Revamp" --project "Mobile App" [--summary "..."]
  mistri card create --project "Mobile App" --feature "Login Revamp" --title "Add reset" --problem "..." --ac "..." --done "..."
  mistri card submit 1
  mistri card show 1
  mistri card list [--status pending_approval]
  mistri admin approve 1
  mistri admin changes 1 --reason "Acceptance criteria too vague"
  mistri admin reject 1 --reason "Not a priority"
  mistri admin done 1
  mistri claim 1 --role developer [--agent dev-agent]
  mistri move 1 review --role developer
  mistri note 1 "Implemented reset token flow" [--role developer]
  mistri board

Global:
  --actor name
  --json
`);
}

module.exports = {
  parseArgv,
  runCli,
};

