const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { createRelay } = require("./domain");

const WEB_ROOT = path.join(__dirname, "..", "web");
const STATIC_FILES = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

async function startServer({ dbPath, cwd = process.cwd(), host = "127.0.0.1", port = 4173 }) {
  const token = crypto.randomBytes(24).toString("hex");
  const server = http.createServer((request, response) => {
    handleRequest({ request, response, dbPath, cwd, token }).catch((error) => {
      sendJson(response, 500, { error: error.message });
    });
  });

  const selectedPort = await listen(server, host, Number(port));
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    server,
    token,
    url: `http://${host}:${selectedPort}`,
  };
}

async function handleRequest({ request, response, dbPath, cwd, token }) {
  setSecurityHeaders(response);
  const url = new URL(request.url, "http://localhost");

  if (request.method === "GET" && url.pathname === "/config.js") {
    send(response, 200, `window.RELAY_CONFIG = ${JSON.stringify({ token })};\n`, "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi({ request, response, url, dbPath, cwd, token });
    return;
  }

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const staticFile = STATIC_FILES[url.pathname];
  if (!staticFile) {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  const body = await fs.readFile(path.join(WEB_ROOT, staticFile.file));
  send(response, 200, body, staticFile.type);
}

async function handleApi({ request, response, url, dbPath, cwd, token }) {
  if (request.method !== "GET" && request.headers["x-relay-token"] !== token) {
    sendJson(response, 403, { error: "Invalid request token." });
    return;
  }

  const app = createRelay({ dbPath, cwd });
  try {
    const parts = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/api/board") {
      sendJson(response, 200, boardWithEvents(app.board(boardFilters(url)), app));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/navigation") {
      sendJson(response, 200, navigation(app));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/agents") {
      sendJson(response, 200, agentsView(app));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/inbox") {
      sendJson(response, 200, inboxView(app));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/projects") {
      sendJson(response, 200, app.listProjects());
      return;
    }

    if (request.method === "GET" && parts[1] === "cards" && parts[2]) {
      sendJson(response, 200, app.getCard(parts[2]));
      return;
    }

    if (request.method === "POST" && parts[1] === "cards" && parts[3] === "submit") {
      const body = await readBody(request);
      sendJson(response, 200, app.submitCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "admin" && parts[2] && parts[3]) {
      const body = await readBody(request);
      const input = { ...body, role: "admin" };
      const actions = {
        approve: () => app.approveCard(parts[3], input),
        changes: () => app.requestChanges(parts[3], input),
        reject: () => app.rejectCard(parts[3], input),
        pause: () => app.pauseCard(parts[3], input),
        cancel: () => app.cancelCard(parts[3], input),
        done: () => app.completeCard(parts[3], input),
      };

      const action = actions[parts[2]];
      if (!action) {
        sendJson(response, 404, { error: "Unknown admin action." });
        return;
      }
      sendJson(response, 200, action());
      return;
    }

    if (request.method === "POST" && parts[1] === "claim" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.claimCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "move" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.moveCard(parts[2], body));
      return;
    }

    if (request.method === "POST" && parts[1] === "note" && parts[2]) {
      const body = await readBody(request);
      sendJson(response, 200, app.addNote(parts[2], body));
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    sendJson(response, 400, { error: error.message });
  } finally {
    app.close();
  }
}

function boardFilters(url) {
  const view = url.searchParams.get("view");
  const projectId = positiveInteger(url.searchParams.get("project"), "project");
  const featureId = positiveInteger(url.searchParams.get("feature"), "feature");
  const filters = {};

  if (projectId) filters.projectId = projectId;
  if (featureId) filters.featureId = featureId;
  if (view === "approvals") filters.approvalStatus = "pending";
  if (view && view !== "approvals") throw new Error("Unknown board view.");

  return filters;
}

function boardWithEvents(board, app) {
  return Object.fromEntries(
    Object.entries(board).map(([status, cards]) => [
      status,
      cards.map((card) => ({
        ...card,
        events: app.getCard(card.id).events,
      })),
    ]),
  );
}

function navigation(app) {
  const allCards = app.listCards();
  const inbox = inboxView(app);
  const projects = app.listProjects().map((project) => {
    const features = app.listFeatures(project.id).map((feature) => ({
      ...feature,
      counts: counts(allCards.filter((card) => card.featureId === feature.id)),
    }));

    return {
      ...project,
      counts: counts(allCards.filter((card) => card.projectId === project.id)),
      features,
    };
  });

  return {
    counts: counts(allCards),
    inboxCounts: inbox.counts,
    onlineAgents: app.listOnlineAgents(),
    projects,
  };
}

function inboxView(app) {
  const cards = app.listCards().map((card) => ({
    ...card,
    events: app.getCard(card.id).events,
  }));
  const actionItems = [];
  const waitingItems = [];
  const updateItems = [];

  for (const card of cards) {
    const latest = card.events.at(-1);

    if (card.status === "pending_approval") {
      actionItems.push(inboxItem(card, latest, {
        action: "approval",
        kind: "admin_action",
        label: "Needs approval",
        message: latest?.message || firstText(card.acceptanceCriteria) || card.problemStatement,
        tone: "pending",
      }));
    }

    if (card.status === "testing") {
      actionItems.push(inboxItem(card, latest, {
        action: "done",
        kind: "admin_action",
        label: "QA decision",
        message: latest?.message || "QA is waiting for admin closeout.",
        tone: "testing",
      }));
    }

    if (card.status === "needs_changes") {
      waitingItems.push(inboxItem(card, latest, {
        action: "follow_up",
        kind: "waiting",
        label: "PM revision needed",
        message: latest?.message || "PM needs to revise and resubmit this card.",
        tone: "waiting",
      }));
    }

    for (const event of card.events) {
      if (event.role === "admin") continue;
      if (!["card.claimed", "card.linked", "card.moved", "card.note", "card.revised", "card.submitted"].includes(event.action)) {
        continue;
      }
      updateItems.push(inboxItem(card, event, {
        action: "open",
        kind: "agent_update",
        label: actionLabel(event.action),
        message: event.message,
        tone: event.role,
      }));
    }
  }

  const sortNewest = (left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.eventId - left.eventId;
  actionItems.sort(sortNewest);
  waitingItems.sort(sortNewest);
  updateItems.sort(sortNewest);

  return {
    actionItems,
    counts: {
      action: actionItems.length,
      total: actionItems.length + waitingItems.length + updateItems.length,
      updates: updateItems.length,
      waiting: waitingItems.length,
    },
    updateItems: updateItems.slice(0, 30),
    waitingItems,
  };
}

function agentsView(app) {
  const onlineAgents = app.listOnlineAgents();
  const onlineByName = new Map(onlineAgents.map((agent) => [agent.agent, agent]));
  const cards = app.listCards().map((card) => ({
    ...card,
    events: app.getCard(card.id).events,
  }));
  const names = new Set(onlineAgents.map((agent) => agent.agent));

  for (const card of cards) {
    if (card.assignedAgent) names.add(card.assignedAgent);
  }

  return Array.from(names)
    .sort((left, right) => {
      const leftOnline = onlineByName.has(left) ? 0 : 1;
      const rightOnline = onlineByName.has(right) ? 0 : 1;
      return leftOnline - rightOnline || left.localeCompare(right);
    })
    .map((name) => {
      const online = onlineByName.get(name);
      const assignedCards = cards.filter((card) => card.assignedAgent === name);
      const activeCards = assignedCards.filter(
        (card) => !["done", "rejected", "cancelled"].includes(card.status),
      );
      const recentEvents = cards
        .flatMap((card) =>
          card.events
            .filter((event) => event.actor === name)
            .map((event) => ({
              ...event,
              cardTitle: card.title,
              cardStatus: card.status,
            })),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 5);

      return {
        agent: name,
        role: online?.role || assignedCards.find((card) => card.assignedAgent === name)?.assignedRole || "unknown",
        online: Boolean(online),
        lastSeen: online?.lastSeen || "",
        activeCards,
        assignedCards,
        recentEvents,
      };
    });
}

function counts(cards) {
  return {
    active: cards.filter((card) => ["in_progress", "review", "testing"].includes(card.status)).length,
    pending: cards.filter((card) => card.approvalStatus === "pending").length,
    total: cards.length,
  };
}

function inboxItem(card, event, input) {
  return {
    action: input.action,
    actor: event?.actor || "",
    cardId: card.id,
    cardStatus: card.status,
    createdAt: event?.createdAt || card.updatedAt,
    eventId: event?.id || 0,
    featureName: card.featureName,
    id: `${input.kind}-${card.id}-${event?.id || card.updatedAt}`,
    kind: input.kind,
    label: input.label,
    message: input.message || "",
    projectName: card.projectName,
    role: event?.role || card.expectedRole,
    sprint: card.sprint,
    storyPoints: card.storyPoints,
    title: card.title,
    tone: input.tone,
  };
}

function firstText(values) {
  if (!Array.isArray(values)) return values || "";
  return values.find(Boolean) || "";
}

function actionLabel(action) {
  const labels = {
    "card.claimed": "Claimed",
    "card.linked": "Linked",
    "card.moved": "Moved",
    "card.note": "Update",
    "card.revised": "Revised",
    "card.submitted": "Submitted",
  };
  return labels[action] || action.replaceAll(".", " ");
}

function positiveInteger(value, label) {
  if (!value) return null;
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1 || String(number) !== value) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const tryPort = (candidate) => {
      server.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          tryPort(candidate + 1);
          return;
        }
        reject(error);
      });

      server.listen(candidate, host, () => {
        server.removeAllListeners("error");
        resolve(server.address().port);
      });
    };

    tryPort(port);
  });
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

module.exports = {
  startServer,
};
