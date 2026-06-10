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
  navigation: null,
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refreshButton").addEventListener("click", loadApp);
  document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
  document.getElementById("drawer").addEventListener("click", (event) => {
    if (event.target.id === "drawer") closeDrawer();
  });
  window.addEventListener("popstate", loadApp);
  loadApp();
});

async function loadApp() {
  const [navigation, board] = await Promise.all([request("/api/navigation"), request(boardPath())]);
  state.navigation = navigation;
  state.board = board;
  renderNavigation(navigation);
  render(board);
}

function boardPath() {
  const filter = currentFilter();
  const params = new URLSearchParams();
  if (filter.view) params.set("view", filter.view);
  if (filter.project) params.set("project", filter.project);
  if (filter.feature) params.set("feature", filter.feature);
  const query = params.toString();
  return query ? `/api/board?${query}` : "/api/board";
}

function render(board) {
  const cards = STATUSES.flatMap((status) => board[status] || []);
  const pending = board.pending_approval || [];
  const active = ["in_progress", "review", "testing"].flatMap((status) => board[status] || []);
  const activePoints = active.reduce((total, card) => total + (card.storyPoints || 0), 0);

  document.getElementById("summary").textContent = `${contextTitle()} · ${pending.length} pending approval · ${active.length} active · ${activePoints} active points · ${cards.length} total`;
  document.getElementById("approvalCount").textContent = pending.length;
  document.getElementById("activeCount").textContent = active.length;
  document.getElementById("cardCount").textContent = cards.length;
  document.getElementById("boardTitle").textContent = contextTitle();

  renderApprovalQueue(pending);
  renderActiveWork(active);
  renderBoard(board);
}

function renderNavigation(navigation) {
  const root = document.getElementById("projectNav");
  const filter = currentFilter();
  root.replaceChildren();

  root.append(
    navLink("All Work", navigation.counts, "/", !filter.view && !filter.project && !filter.feature),
    navLink("Needs Approval", { total: navigation.counts.pending }, "/?view=approvals", filter.view === "approvals"),
  );

  if (navigation.projects.length === 0) {
    root.append(empty("No projects yet."));
    return;
  }

  for (const project of navigation.projects) {
    const projectActive = filter.project === String(project.id);
    const projectNode = el("div", "nav-group");
    projectNode.append(
      navLink(project.name, project.counts, `/?project=${project.id}`, projectActive),
    );

    const featureList = el("div", "feature-list");
    for (const feature of project.features) {
      featureList.append(
        navLink(feature.name, feature.counts, `/?feature=${feature.id}`, filter.feature === String(feature.id), "feature-link"),
      );
    }
    projectNode.append(featureList);
    root.append(projectNode);
  }
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
    column.dataset.status = status;
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
  await loadApp();
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

function navLink(text, counts, href, active, extraClass = "") {
  const node = el("a", `nav-link ${extraClass}${active ? " active" : ""}`.trim());
  node.href = href;
  node.addEventListener("click", (event) => {
    event.preventDefault();
    window.history.pushState({}, "", href);
    loadApp();
  });

  node.append(el("span", "nav-label", text));
  const badges = el("span", "nav-badges");
  if (counts.pending) badges.append(el("span", "badge pending", String(counts.pending)));
  if (counts.active) badges.append(el("span", "badge active", String(counts.active)));
  badges.append(el("span", "badge", String(counts.total || 0)));
  node.append(badges);
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

function currentFilter() {
  const params = new URLSearchParams(window.location.search);
  return {
    feature: params.get("feature"),
    project: params.get("project"),
    view: params.get("view"),
  };
}

function contextTitle() {
  const filter = currentFilter();
  if (filter.view === "approvals") return "Needs Approval";
  if (!state.navigation) return "Board";

  if (filter.feature) {
    for (const project of state.navigation.projects) {
      const feature = project.features.find((item) => String(item.id) === filter.feature);
      if (feature) return `${project.name} / ${feature.name}`;
    }
  }

  if (filter.project) {
    const project = state.navigation.projects.find((item) => String(item.id) === filter.project);
    if (project) return project.name;
  }

  return "All Work";
}
