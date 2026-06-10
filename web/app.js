const STATUSES = [
  "draft",
  "pending_approval",
  "needs_changes",
  "rejected",
  "ready",
  "in_progress",
  "review",
  "testing",
  "done",
  "paused",
  "cancelled",
];
const STATUS_LABELS = {
  draft: "Product Backlog",
  pending_approval: "Admin Approval",
  needs_changes: "Needs Refinement",
  rejected: "Rejected",
  ready: "Ready",
  in_progress: "In Progress",
  review: "Code Review",
  testing: "QA",
  done: "Done",
  paused: "Paused",
  cancelled: "Cancelled",
};
const WIP_LIMITS = {
  ready: 8,
  in_progress: 3,
  review: 3,
  testing: 3,
};

const state = {
  board: {},
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refreshButton").addEventListener("click", loadBoard);
  document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
  document.getElementById("drawer").addEventListener("click", (event) => {
    if (event.target.id === "drawer") closeDrawer();
  });
  loadBoard();
});

async function loadBoard() {
  const board = await request("/api/board");
  state.board = board;
  render(board);
}

function render(board) {
  const cards = STATUSES.flatMap((status) => board[status] || []);
  const pending = board.pending_approval || [];
  const active = ["in_progress", "review", "testing"].flatMap((status) => board[status] || []);
  const activePoints = active.reduce((total, card) => total + (card.storyPoints || 0), 0);

  document.getElementById("summary").textContent = `${pending.length} pending approval · ${active.length} active · ${activePoints} active points · ${cards.length} total`;
  document.getElementById("approvalCount").textContent = pending.length;
  document.getElementById("activeCount").textContent = active.length;
  document.getElementById("cardCount").textContent = cards.length;

  renderApprovalQueue(pending);
  renderActiveWork(active);
  renderBoard(board);
}

function renderApprovalQueue(cards) {
  const root = document.getElementById("approvalQueue");
  root.replaceChildren();

  if (cards.length === 0) {
    root.append(empty("No pending approvals."));
    return;
  }

  for (const card of cards) {
    const node = cardNode(card);
    const actions = el("div", "actions");
    actions.append(
      button("Approve", "action primary", () => adminAction("approve", card.id)),
      button("Changes", "action warning", () => {
        const reason = window.prompt("Reason");
        if (reason) adminAction("changes", card.id, { reason });
      }),
      button("Reject", "action danger", () => {
        const reason = window.prompt("Reason");
        if (reason) adminAction("reject", card.id, { reason });
      }),
    );
    node.append(actions);
    root.append(node);
  }
}

function renderActiveWork(cards) {
  const root = document.getElementById("activeWork");
  root.replaceChildren();

  if (cards.length === 0) {
    root.append(empty("No active work."));
    return;
  }

  for (const card of cards) {
    const node = cardNode(card);
    if (card.status === "testing") {
      const actions = el("div", "actions");
      actions.append(button("Done", "action primary", () => adminAction("done", card.id)));
      node.append(actions);
    }
    root.append(node);
  }
}

function renderBoard(board) {
  const root = document.getElementById("board");
  root.replaceChildren();

  for (const status of STATUSES) {
    const cards = board[status] || [];
    const column = el("section", "column");
    const heading = el("h3");
    const limit = WIP_LIMITS[status];
    if (limit && cards.length > limit) column.classList.add("over-limit");
    heading.append(document.createTextNode(label(status)), el("span", "", limit ? `${cards.length}/${limit}` : String(cards.length)));
    column.append(heading);

    if (cards.length === 0) {
      column.append(empty("Empty"));
    } else {
      for (const card of cards) column.append(cardNode(card));
    }

    root.append(column);
  }
}

function cardNode(card) {
  const node = el("button", "card");
  node.dataset.status = card.status;
  node.type = "button";
  node.addEventListener("click", () => openCard(card.id));

  node.append(
    el("h3", "", card.title),
    meta([
      `#${card.id}`,
      card.projectName,
      card.featureName,
      label(card.status),
      `P${card.priority}`,
      card.storyPoints > 0 ? `${card.storyPoints}sp` : "",
      card.sprint,
      card.assignedAgent || card.expectedRole,
    ]),
  );

  return node;
}

async function openCard(id) {
  const card = await request(`/api/cards/${id}`);
  const root = document.getElementById("cardDetail");
  root.replaceChildren();

  const detail = el("div", "detail");
  detail.append(
    el("h2", "", card.title),
    meta([
      `#${card.id}`,
      card.projectName,
      card.featureName,
      label(card.status),
      card.riskLevel,
      card.storyPoints > 0 ? `${card.storyPoints}sp` : "",
      card.sprint,
    ]),
    block("User Story", card.userStory),
    block("Problem", card.problemStatement),
    listBlock("Acceptance Criteria", card.acceptanceCriteria),
    block("Definition of Done", card.definitionOfDone),
    block("Repo", card.targetRepo),
    block("Owner", card.assignedAgent || card.expectedRole),
    eventsBlock(card.events),
  );

  root.append(detail);
  document.getElementById("drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  document.getElementById("drawer").setAttribute("aria-hidden", "true");
}

async function adminAction(action, id, body = {}) {
  await request(`/api/admin/${action}/${id}`, {
    method: "POST",
    body: JSON.stringify({ actor: "admin", ...body }),
  });
  await loadBoard();
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Mistri-Token": window.MISTRI_CONFIG.token,
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function block(title, value) {
  const node = el("section", "detail-block");
  node.append(el("h3", "", title), el("p", "muted", value || "None"));
  return node;
}

function listBlock(title, values) {
  const node = el("section", "detail-block");
  const list = el("ul");
  for (const value of values || []) list.append(el("li", "", value));
  node.append(el("h3", "", title), list);
  return node;
}

function eventsBlock(events) {
  const node = el("section", "detail-block");
  const list = el("div", "event-list");
  for (const event of events || []) {
    list.append(
      el("div", "event", `${event.createdAt} · ${event.role}:${event.actor} · ${event.action} · ${event.message}`),
    );
  }
  node.append(el("h3", "", "Events"), list);
  return node;
}

function meta(items) {
  const node = el("div", "meta");
  for (const item of items.filter(Boolean)) node.append(el("span", "pill", item));
  return node;
}

function button(text, className, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return node;
}

function empty(text) {
  return el("div", "empty", text);
}

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function label(value) {
  return STATUS_LABELS[value] || String(value).replaceAll("_", " ");
}
