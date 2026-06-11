const fs = require("node:fs");
const path = require("node:path");
const { CARD_STATUSES, WIP_LIMITS } = require("./constants");
const { createRelay } = require("./domain");
const { requireWorkspace, workspaceForInit } = require("./paths");
const { startServer } = require("./server");

async function runCli(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  const parsed = parseArgv(argv);
  const [area, action, ...rest] = parsed.positionals;

  if (!area || area === "help" || parsed.flags.help) {
    printHelp();
    return;
  }

  const selectedDb = parsed.flags.db || env.RELAY_DB;

  if (area === "init") {
    const workspace = workspaceForInit(cwd, selectedDb, env);
    fs.mkdirSync(workspace.relayDir, { recursive: true });
    const app = createRelay({ dbPath: workspace.dbPath, cwd });
    app.close();
    print({ message: `Initialized Relay at ${workspace.dbPath}` }, parsed.flags.json);
    return;
  }

  const workspace = requireWorkspace(cwd, selectedDb, env);

  if (area === "db") {
    print(workspace, parsed.flags.json);
    return;
  }

  if (area === "ui") {
    const app = await startServer({
      dbPath: workspace.dbPath,
      cwd,
      port: parsed.flags.port || 4173,
    });
    console.log(`Relay UI running at ${app.url}`);
    await waitForShutdown(app);
    return;
  }

  const app = createRelay({ dbPath: workspace.dbPath, cwd });

  try {
    const result = dispatch(app, env, parsed, area, action, rest, cwd);
    if (result !== undefined) print(result, parsed.flags.json);
  } finally {
    app.close();
  }
}

function waitForShutdown(app) {
  return new Promise((resolve) => {
    const stop = async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await app.close();
      resolve();
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

function dispatch(app, env, parsed, area, action, rest, cwd) {
  const flags = parsed.flags;
  const actor = flags.actor || env.USER || "unknown";

  if (area !== "agent") {
    app.heartbeat({
      actor,
      agent: flags.agent || actor,
      role: inferredHeartbeatRole(area, action, flags),
    });
  }

  if (area === "agent") {
    if (action === "heartbeat") {
      return app.heartbeat({
        actor,
        agent: flags.agent || actor,
        role: requiredFlag(flags, "role"),
      });
    }

    if (action === "list") {
      return app.listOnlineAgents({ windowMs: flags.windowMs });
    }

    if (action === "inbox") {
      const agent = flags.agent || actor;
      if (flags.role) app.heartbeat({ agent, role: flags.role });
      return app.listAgentNotifications({
        agent,
        role: flags.role,
        unread: flags.unread === true,
      });
    }

    if (action === "ack") {
      const agent = flags.agent || actor;
      if (flags.role) app.heartbeat({ agent, role: flags.role });
      return app.acknowledgeNotification(one(rest, "Notification id"), {
        agent,
        role: flags.role,
      });
    }
  }

  if (area === "project") {
    if (action === "create") {
      return app.createProject({
        feature: requiredFlag(flags, "feature"),
        name: one(rest, "Project name"),
        description: flags.description,
        actor,
        role: flags.role || "admin",
      });
    }

    if (action === "list") {
      return app.listProjects({ feature: flags.feature });
    }
  }

  if (area === "feature") {
    if (action === "create") {
      return app.createFeature({
        name: one(rest, "Feature name"),
        summary: flags.summary,
        actor,
        role: flags.role || "pm",
      });
    }

    if (action === "list") {
      return app.listFeatures();
    }
  }

  if (area === "card") {
    if (action === "create") {
      return app.createCard({
        project: requiredFlag(flags, "project"),
        feature: requiredFlag(flags, "feature"),
        title: requiredFlag(flags, "title"),
        userStory: flags.story,
        problemStatement: requiredFlag(flags, "problem"),
        acceptanceCriteria: flags.ac || flags.acceptance,
        definitionOfDone: requiredFlag(flags, "done"),
        targetRepo: flags.repo,
        expectedRole: flags.expectedRole || flags.role || "developer",
        riskLevel: flags.risk || "medium",
        storyPoints: flags.points,
        sprint: flags.sprint,
        priority: flags.priority,
        actor,
        role: flags.createdByRole || "pm",
      });
    }

    if (action === "submit") {
      return app.submitCard(one(rest, "Card id"), { actor, role: flags.role || "pm" });
    }

    if (action === "revise") {
      const input = {
        title: flags.title,
        userStory: flags.story,
        problemStatement: flags.problem,
        definitionOfDone: flags.done,
        targetRepo: flags.repo,
        expectedRole: flags.expectedRole || flags.role,
        riskLevel: flags.risk,
        storyPoints: flags.points,
        sprint: flags.sprint,
        priority: flags.priority,
        message: flags.note || flags.message,
        submit: flags.submit === true,
        actor,
        role: flags.actorRole || "pm",
      };

      if (flags.ac !== undefined || flags.acceptance !== undefined) {
        input.acceptanceCriteria = flags.ac !== undefined ? flags.ac : flags.acceptance;
      }

      return app.reviseCard(one(rest, "Card id"), input);
    }

    if (action === "show") {
      return app.getCard(one(rest, "Card id"));
    }

    if (action === "lint") {
      return app.lintCard(one(rest, "Card id"));
    }

    if (action === "list") {
      return app.listCards({
        status: flags.status,
        approvalStatus: flags.approval,
      });
    }
  }

  if (area === "brief") {
    return app.briefCard(action, {
      role: requiredFlag(flags, "role"),
    });
  }

  if (area === "context") {
    if (action === "add") {
      return app.addContextLayer({
        project: flags.project,
        feature: flags.feature,
        card: flags.card,
        type: requiredFlag(flags, "type"),
        title: requiredFlag(flags, "title"),
        body: readBody(flags, cwd),
        actor,
        role: flags.role || "developer",
      });
    }

    if (action === "list") {
      return app.listContextLayers({
        project: flags.project,
        feature: flags.feature,
        card: flags.card,
        type: flags.type,
        includeSuperseded: flags.all === true,
      });
    }

    if (action === "show") {
      return app.getContextLayer(one(rest, "Layer id"));
    }

    if (action === "supersede") {
      return app.supersedeContextLayer(one(rest, "Layer id"), {
        title: flags.title,
        body: readBody(flags, cwd),
        actor,
        role: flags.role || "developer",
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
      handoff: readOptionalTextSource(flags, cwd, {
        inlineKey: "handoff",
        fileKey: "handoff-file",
      }),
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

  throw new Error(`Unknown command. Run \`relay help\` for usage.`);
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
    if (value.every(isNotification)) {
      printNotifications(value);
      return;
    }
    printList(value);
    return;
  }

  if (isNotification(value)) {
    printNotification(value);
    return;
  }

  if (value && value.brief && value.brief.card && value.brief.layers && value.brief.nextAction) {
    printBrief(value.brief);
    return;
  }

  if (value && value.events) {
    printCard(value);
    return;
  }

  if (value && value.card && value.layers && value.nextAction) {
    printBrief(value);
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
    const limit = WIP_LIMITS[status] ? ` / ${WIP_LIMITS[status]}` : "";
    const warning = WIP_LIMITS[status] && cards.length > WIP_LIMITS[status] ? " over WIP" : "";
    console.log(`${status} (${cards.length}${limit})${warning}`);
    for (const card of cards) {
      const points = card.storyPoints > 0 ? ` ${card.storyPoints}sp` : "";
      const sprint = card.sprint ? ` ${card.sprint}` : "";
      console.log(`  #${card.id} P${card.priority}${points}${sprint} ${card.title} [${card.featureName}/${card.projectName}]`);
    }
  }
}

function printBrief(brief) {
  const card = brief.card;
  console.log(`#${card.id} ${card.title}`);
  console.log(`${card.featureName} / ${card.projectName} / ${card.status}`);
  console.log("");
  console.log(`Next action: ${brief.nextAction}`);

  const layers = Object.entries(brief.layers);
  if (layers.length > 0) {
    console.log("");
    console.log("Context layers:");
    for (const [type, layer] of layers) {
      console.log(`- ${type} #${layer.id}: ${layer.title} (${layer.scope}, ${layer.actor}/${layer.role})`);
    }
  }

  if (brief.decisions.length > 0) {
    console.log("");
    console.log("Admin decisions:");
    for (const decision of brief.decisions) {
      console.log(`- ${decision.createdAt} ${decision.action}: ${decision.message}`);
    }
  }

  if (brief.recentSendBacks?.length > 0) {
    console.log("");
    console.log("Recent send-backs:");
    for (const reason of brief.recentSendBacks) {
      console.log(`- ${reason}`);
    }
  }

  if (brief.recentEvents.length > 0) {
    console.log("");
    console.log("Recent events:");
    for (const event of brief.recentEvents) {
      console.log(`- ${event.createdAt} ${event.role}:${event.actor} ${event.action} ${event.message}`);
    }
  }
}

function printNotifications(items) {
  if (items.length === 0) {
    console.log("No notifications found.");
    return;
  }

  for (const item of items) printNotification(item);
}

function printNotification(item) {
  const unread = item.readAt ? "read" : "unread";
  const target = item.targetAgent || item.targetRole;
  console.log(
    `#${item.id} ${unread} -> ${target} card #${item.cardId} ${item.event.action} ${item.card.title} [${item.card.featureName}/${item.card.projectName}]`,
  );
  console.log(`${item.event.role}:${item.event.actor} ${item.event.message}`);
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

function isNotification(value) {
  return Boolean(value && value.event && value.card && value.eventId);
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

function readBody(flags, cwd) {
  return readTextSource(flags, cwd, {
    inlineKey: "body",
    fileKey: "body-file",
    required: true,
    allowStdin: true,
  });
}

function readOptionalTextSource(flags, cwd, options) {
  return readTextSource(flags, cwd, { ...options, required: false });
}

function readTextSource(flags, cwd, options) {
  const hasBody = flags[options.inlineKey] !== undefined;
  const hasBodyFile = flags[options.fileKey] !== undefined;
  const inlineLabel = `--${options.inlineKey}`;
  const fileLabel = `--${options.fileKey}`;

  if (Number(hasBody) + Number(hasBodyFile) !== 1) {
    if (options.required) {
      throw new Error(`Exactly one of ${inlineLabel} or ${fileLabel} is required.`);
    }
    if (Number(hasBody) + Number(hasBodyFile) > 1) {
      throw new Error(`Only one of ${inlineLabel} or ${fileLabel} can be provided.`);
    }
    return undefined;
  }

  if (hasBody) {
    if (flags[options.inlineKey] === true) throw new Error(`${inlineLabel} requires text${options.allowStdin ? " or -" : ""}.`);
    if (options.allowStdin && flags[options.inlineKey] === "-") return fs.readFileSync(0, "utf8");
    return flags[options.inlineKey];
  }

  if (flags[options.fileKey] === true) throw new Error(`${fileLabel} requires a path.`);
  return fs.readFileSync(path.resolve(cwd, flags[options.fileKey]), "utf8");
}

function inferredHeartbeatRole(area, action, flags) {
  if (area === "admin") return "admin";
  if (area === "project") return flags.role || "admin";
  if (area === "feature") return "pm";
  if (area === "card" && ["create", "submit", "revise"].includes(action)) return flags.actorRole || "pm";
  if (["claim", "move", "note", "link"].includes(area)) return flags.role || "developer";
  return flags.actorRole || flags.role || "pm";
}

function printHelp() {
  console.log(`Relay - admin-first project board for agent work

Agent contract:
  Use one shared Relay DB. Run relay init once; agents can then use the standard local default.
  Prefer --json for machine-readable output.
  Check your inbox before work, after handoffs, and while waiting for feedback.
  Acknowledge notifications only after you have handled them.
  Post Markdown notes for progress, blockers, review findings, and QA evidence.

Agent loop:
  relay db --json
  relay agent heartbeat --agent dev-agent --role developer --json
  relay agent inbox --agent dev-agent --role developer --unread --json
  relay brief 12 --role developer --json
  relay claim 12 --agent dev-agent --role developer --json
  relay note 12 $'## Progress\\n- Implemented core path\\n- Tests pending' --actor dev-agent --role developer
  relay move 12 review --actor dev-agent --role developer --handoff-file handoff.md --json
  relay agent ack 34 --agent dev-agent --role developer --json

Role handoffs:
  developer: claim ready cards, post progress, move in_progress -> review
  reviewer: post review findings, move review -> testing or review -> in_progress
  tester: post QA evidence, move testing -> in_progress when fixes are needed
  pm: create/revise/submit cards, respond to admin needs-changes
  admin: approve, request changes, reject, pause, cancel, mark done

Common commands:
  relay board --json
  relay brief 12 --role developer --json
  relay card list [--status pending_approval] [--json]
  relay card show 12 --json
  relay card lint 12 --json
  relay note 12 "Status update" --actor dev-agent --role developer
  relay link 12 --branch feature/reset --commit abc123 --pr https://...
  relay context add --card 12 --type implementation_notes --title "Backend changes" --body-file notes.md
  relay context list --card 12 --all --json
  relay context show 5 --json
  relay context supersede 5 --body - --title "Updated notes" --json
  relay agent inbox --agent dev-agent --role developer [--unread] [--json]
  relay agent ack 34 --agent dev-agent --role developer [--json]
  relay agent list --json

PM card writing:
  Title: imperative, <=60 chars, names the outcome. Example: "Add rate limiting to login endpoint".
  Problem: 2-4 present-tense sentences. State what is true today and why it is a problem; do not describe the solution.
  Acceptance criteria: 3-7 pass/fail bullets. A tester must be able to verify each one without asking questions.
  User story: use only when there is a real user and outcome. Empty is better than boilerplate.
  Definition of done: mechanical checklist only: tests pass, PR linked, validation_evidence written.
  Size: one card = one agent session = one PR. Run relay card lint before submit.

Model card:
  Title: Add rate limiting to login endpoint
  Story: As an account holder, I want repeated failed logins throttled so my account cannot be brute-forced.
  Problem: /api/login accepts unlimited attempts. A script can try thousands of passwords per minute against one account. We have no throttling at any layer.
  AC: >5 failed attempts per IP per minute returns 429; Successful logins are unaffected; The limit resets after 60s; Integration test covers limit, reset, and happy path.
  DoD: tests pass, PR linked, validation_evidence layer written.

PM scope commands:
  relay feature create "Login Revamp" [--summary "..."]
  relay project create "Mobile App" --feature "Login Revamp" [--description "..."]
  relay context add --feature "Login Revamp" --type feature_brief --title "Feature context" --body-file feature.md
  relay context add --project "Login Revamp:Mobile App" --type project_map --title "Repo map" --body-file map.md
  relay card create --feature "Login Revamp" --project "Mobile App" --title "Add reset" --story "As a user..." --problem "..." --ac "..." --done "..." --points 3 --sprint "Sprint 1" --role developer
  relay card lint 12 --json
  relay card submit 12 --actor pm-agent
  relay card revise 12 --ac "Updated criterion" --note "Addressed admin feedback" --submit

Admin commands:
  relay admin approve 12 --actor admin
  relay admin changes 12 --reason "Acceptance criteria too vague" --actor admin
  relay admin reject 12 --reason "Not a priority" --actor admin
  relay admin done 12 --actor admin

Workspace commands:
  relay init
  relay db
  relay ui [--port 4173]

Global flags:
  --actor name     event actor; defaults to $USER
  --agent name     agent identity for heartbeat/claim/inbox
  --role role      admin|pm|developer|reviewer|tester
  --db path        shared control DB path
  --json           machine-readable output

Environment:
  RELAY_DB=/path/to/control/relay.db        explicit shared DB override
  RELAY_DATA_HOME=/path/to/local/data/relay advanced default DB directory override
`);
}

module.exports = {
  parseArgv,
  runCli,
};
