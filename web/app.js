const STATUSES = [
  "draft",
  "pending_approval",
  "needs_changes",
  "ready",
  "in_progress",
  "review",
  "testing",
  "done",
  "rejected",
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
const CANNED_CHANGE_REASONS = [
  "Too big — split it",
  "Solution-shaped — state the problem",
  "Acceptance criteria not testable",
  "Missing context",
];

const state = {
  agents: [],
  board: {},
  contextGaps: null,
  inbox: null,
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
  const [navigation, board, agents, inbox, contextGaps] = await Promise.all([
    request("/api/navigation"),
    request(boardPath()),
    request("/api/agents"),
    request("/api/inbox"),
    request("/api/context/gaps"),
  ]);
  state.navigation = navigation;
  state.board = board;
  state.agents = agents;
  state.inbox = inbox;
  state.contextGaps = contextGaps;
  renderNavigation(navigation);
  render(board);
  const cardId = currentFilter().card;
  if (cardId) openCard(cardId, { updateUrl: false }).catch((error) => window.alert(error.message));
}

function boardPath() {
  const filter = currentFilter();
  const params = new URLSearchParams();
  if (filter.view && !["agents", "inbox"].includes(filter.view)) params.set("view", filter.view);
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
  const onlineCount = state.navigation?.onlineAgents?.length || 0;
  const view = currentFilter().view;
  const agentsMode = view === "agents";
  const inboxMode = view === "inbox";

  document.getElementById("summary").textContent = summaryText({
    active,
    activePoints,
    cards,
    inbox: state.inbox,
    onlineCount,
    pending,
    view,
  });
  document.getElementById("approvalCount").textContent = pending.length;
  document.getElementById("activeCount").textContent = active.length;
  document.getElementById("cardCount").textContent = cards.length;
  document.getElementById("boardTitle").textContent = contextTitle();

  document.getElementById("agentsView").hidden = !agentsMode;
  document.getElementById("inboxView").hidden = !inboxMode;
  document.getElementById("approvalSection").hidden = agentsMode || inboxMode;
  document.getElementById("activeSection").hidden = agentsMode || inboxMode;
  document.getElementById("boardSection").hidden = agentsMode || inboxMode;

  if (agentsMode) {
    renderAgentsView(state.agents);
    return;
  }

  if (inboxMode) {
    renderInboxView(state.inbox, state.contextGaps);
    return;
  }

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
    navLink(
      "Inbox",
      {
        active: navigation.inboxCounts.waiting,
        pending: navigation.inboxCounts.action,
        total: navigation.inboxCounts.action + navigation.inboxCounts.waiting + (navigation.inboxCounts.gaps || 0),
      },
      "/?view=inbox",
      filter.view === "inbox",
    ),
    navLink("Needs Approval", { total: navigation.counts.pending }, "/?view=approvals", filter.view === "approvals"),
    navLink(
      "Agents",
      {
        active: navigation.onlineAgents.length,
        total: state.agents.length || navigation.onlineAgents.length,
      },
      "/?view=agents",
      filter.view === "agents",
    ),
  );

  if (navigation.features.length === 0) {
    root.append(empty("No features yet."));
    return;
  }

  for (const feature of navigation.features) {
    const featureActive = filter.feature === String(feature.id);
    const featureNode = el("div", "nav-group");
    featureNode.append(navLink(feature.name, feature.counts, `/?feature=${feature.id}`, featureActive));

    const projectList = el("div", "feature-list");
    for (const project of feature.projects) {
      projectList.append(
        navLink(project.name, project.counts, `/?project=${project.id}`, filter.project === String(project.id), "feature-link"),
      );
    }
    featureNode.append(projectList);
    root.append(featureNode);
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
      ...changeReasonButtons(card.id),
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
  const node = el("article", "card");
  node.dataset.status = card.status;
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", `Open ${card.title}`);
  node.addEventListener("click", () => openCard(card.id));
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCard(card.id);
    }
  });

  const statusLine = el("div", "card-status-line");
  statusLine.append(el("span", "status-dot"), el("span", "", label(card.status)));

  const heading = el("div", "card-heading");
  heading.append(el("h3", "", card.title));

  node.append(
    statusLine,
    heading,
    ownerChip(card),
    el("p", "card-context", `${card.featureName} / ${card.projectName}`),
    signalPreview(card),
    lintChips(card.lintWarnings || []),
    meta([`#${card.id}`, label(card.status), `P${card.priority}`, card.storyPoints > 0 ? `${card.storyPoints}sp` : "", card.sprint]),
  );

  return node;
}

function renderAgentsView(agents) {
  const root = document.getElementById("agentsView");
  const selectedName = currentFilter().agent;
  const online = agents.filter((agent) => agent.online);
  const activeCards = agents.flatMap((agent) => agent.activeCards || []);
  const idleOnline = online.filter((agent) => (agent.activeCards || []).length === 0);
  const offlineAssigned = agents.filter((agent) => !agent.online && (agent.assignedCards || []).length > 0);
  root.replaceChildren();

  const header = el("div", "agents-hero");
  header.append(
    agentStat("Online", online.length),
    agentStat("Active Work", activeCards.length),
    agentStat("Idle Online", idleOnline.length),
    agentStat("Offline Assigned", offlineAssigned.length),
  );
  root.append(header);

  if (agents.length === 0) {
    root.append(empty("No agents have checked in yet."));
    return;
  }

  const grid = el("div", "agents-grid");
  for (const agent of agents) {
    grid.append(agentNode(agent, selectedName === agent.agent));
  }
  root.append(grid);
}

function agentStat(labelText, value) {
  const node = el("div", "agent-stat");
  node.dataset.metric = slug(labelText);
  node.append(el("strong", "", String(value)), el("span", "", labelText));
  return node;
}

function agentNode(agent, selected) {
  const node = el("article", `agent-card${selected ? " selected" : ""}`.trim());
  node.dataset.online = String(agent.online);

  const header = el("button", "agent-card-header");
  header.type = "button";
  header.addEventListener("click", () => selectAgent(agent.agent));
  header.append(
    presenceDot(agent.online),
    agentIdentity(agent),
    roleChip(agent.role),
    el("span", "agent-work-count", `${(agent.activeCards || []).length} active`),
  );
  node.append(header);

  const body = el("div", "agent-card-body");
  if (selected) {
    body.append(agentWorkBlock("Working On", agent.activeCards || []), agentActivityBlock(agent.recentEvents || []));
  } else {
    const previewCards = (agent.activeCards || []).slice(0, 2);
    if (previewCards.length === 0) {
      body.append(el("p", "agent-muted", agent.online ? "Online with no assigned active card." : "Offline; no active assigned work."));
    } else {
      const list = el("div", "agent-work-preview");
      for (const card of previewCards) list.append(agentWorkItem(card));
      body.append(list);
    }
  }
  node.append(body);

  return node;
}

function agentIdentity(agent) {
  const node = el("div", "agent-identity");
  node.append(
    el("strong", "", agent.agent),
    el("span", "", `${roleLabel(agent.role)} · ${agent.online ? `seen ${formatTime(agent.lastSeen)}` : "offline"}`),
  );
  return node;
}

function agentWorkBlock(title, cards) {
  const node = el("section", "agent-detail-block");
  node.append(el("h3", "", title));
  if (cards.length === 0) {
    node.append(empty("No active assigned work."));
    return node;
  }

  const list = el("div", "agent-work-list");
  for (const card of cards) list.append(agentWorkItem(card));
  node.append(list);
  return node;
}

function agentActivityBlock(events) {
  const node = el("section", "agent-detail-block");
  node.append(el("h3", "", "Recent Activity"));
  if (events.length === 0) {
    node.append(empty("No recent activity from this agent."));
    return node;
  }

  const list = el("div", "agent-activity-list");
  for (const event of events) {
    const item = el("div", "agent-activity-item");
    item.append(
      el("strong", "", actionLabel(event.action)),
      el("span", "", `${event.cardTitle} · ${formatTime(event.createdAt)}`),
      el("p", "", plainPreview(event.message || "")),
    );
    list.append(item);
  }
  node.append(list);
  return node;
}

function agentWorkItem(card) {
  const node = el("button", "agent-work-item");
  node.type = "button";
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    openCard(card.id);
  });
  node.append(
    el("strong", "", card.title),
    el("span", "", `${card.featureName} / ${card.projectName}`),
    meta([`#${card.id}`, label(card.status), card.storyPoints > 0 ? `${card.storyPoints}sp` : "", card.sprint]),
  );
  return node;
}

function renderInboxView(inbox, gaps) {
  const root = document.getElementById("inboxView");
  root.replaceChildren();

  const actionItems = inbox?.actionItems || [];
  const waitingItems = inbox?.waitingItems || [];
  const updateItems = inbox?.updateItems || [];
  const gapItems = contextGapItems(gaps || inbox?.contextGaps);
  const updateCount = inbox?.counts?.updates ?? updateItems.length;

  const header = el("div", "inbox-hero");
  header.append(
    inboxStat("Needs Admin", actionItems.length),
    inboxStat("Waiting", waitingItems.length),
    inboxStat("Agent Updates", updateCount),
    inboxStat("Context Gaps", gapItems.length),
  );
  root.append(header);

  if (actionItems.length + waitingItems.length + updateItems.length + gapItems.length === 0) {
    root.append(empty("Inbox is clear."));
    return;
  }

  root.append(
    inboxBlock("Needs Admin", actionItems, "No admin decisions waiting."),
    inboxBlock("Waiting On Agents", waitingItems, "No PM or agent follow-up waiting."),
    inboxBlock("Context Gaps", gapItems, "No context gaps found."),
    inboxBlock("Recent Agent Updates", updateItems, "No recent agent updates."),
  );
}

function inboxStat(labelText, value) {
  const node = el("div", "inbox-stat");
  node.append(el("strong", "", String(value)), el("span", "", labelText));
  return node;
}

function inboxBlock(title, items, emptyText) {
  const section = el("section", "inbox-block");
  section.append(el("h2", "", title));

  if (items.length === 0) {
    section.append(empty(emptyText));
    return section;
  }

  const list = el("div", "inbox-list");
  for (const item of items) list.append(inboxItem(item));
  section.append(list);
  return section;
}

function inboxItem(item) {
  const node = el("article", "inbox-item");
  node.dataset.tone = item.tone;
  if (item.cardId) {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Open ${item.title}`);
    node.addEventListener("click", () => openCard(item.cardId));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCard(item.cardId);
      }
    });
  } else {
    node.classList.add("static");
  }

  const head = el("div", "inbox-item-head");
  head.append(
    el("span", "inbox-label", item.label),
    el("span", "inbox-time", formatTime(item.createdAt)),
  );

  const body = el("div", "inbox-item-body");
  body.append(
    el("h3", "", item.title),
    el("p", "", plainPreview(item.message || "No message.")),
    meta([
      item.cardId ? `#${item.cardId}` : "",
      item.featureName,
      item.projectName,
      item.cardStatus ? label(item.cardStatus) : "",
      item.role ? roleLabel(item.role) : "",
      item.actor,
      item.storyPoints > 0 ? `${item.storyPoints}sp` : "",
      item.sprint,
    ]),
  );
  const chips = lintChips(item.lintWarnings || []);
  if ((item.lintWarnings || []).length > 0) body.append(chips);

  node.append(head, body);
  const actions = inboxActions(item);
  if (actions) node.append(actions);
  return node;
}

function contextGapItems(gaps) {
  if (!gaps) return [];
  return [
    ...(gaps.missingFeatureBriefs || []).map((feature) => ({
      action: "context_gap",
      actor: "",
      cardId: null,
      cardStatus: "",
      createdAt: feature.createdAt,
      featureName: feature.name,
      id: `feature-brief-${feature.id}`,
      kind: "context_gap",
      label: "Feature brief missing",
      message: "Agents will miss product and cross-project context until a feature_brief layer exists.",
      projectName: "",
      role: "",
      title: feature.name,
      tone: "waiting",
    })),
    ...(gaps.missingProjectMaps || []).map((project) => ({
      action: "context_gap",
      actor: "",
      cardId: null,
      cardStatus: "",
      createdAt: project.createdAt,
      featureName: project.featureName || "",
      id: `project-map-${project.id}`,
      kind: "context_gap",
      label: "Project map missing",
      message: "Agents will re-explore this project until a project_map layer exists.",
      projectName: project.name,
      role: "",
      title: project.name,
      tone: "waiting",
    })),
    ...(gaps.reviewWithoutNotes || []).map((card) =>
      contextCardGap(card, "Missing implementation_notes", "Reviewer lacks implementation context.", "review"),
    ),
    ...(gaps.testingWithoutEvidence || []).map((card) =>
      contextCardGap(card, "Missing validation_evidence", "Tester lacks explicit validation claims.", "testing"),
    ),
  ];
}

function contextCardGap(card, labelText, message, tone) {
  return {
    action: "context_gap",
    actor: card.assignedAgent,
    cardId: card.id,
    cardStatus: card.status,
    createdAt: card.updatedAt,
    featureName: card.featureName,
    id: `context-gap-${card.id}-${labelText}`,
    kind: "context_gap",
    label: labelText,
    message,
    projectName: card.projectName,
    role: card.assignedRole || card.expectedRole,
    sprint: card.sprint,
    storyPoints: card.storyPoints,
    title: card.title,
    tone,
  };
}

function inboxActions(item) {
  if (item.action === "approval") {
    const actions = el("div", "actions");
    actions.append(
      button("Approve", "action primary", () => adminAction("approve", item.cardId)),
      ...changeReasonButtons(item.cardId),
      button("Reject", "action danger", () => {
        const reason = window.prompt("Reason");
        if (reason) adminAction("reject", item.cardId, { reason });
      }),
    );
    return actions;
  }

  if (item.action === "done") {
    const actions = el("div", "actions");
    actions.append(button("Done", "action primary", () => adminAction("done", item.cardId)));
    return actions;
  }

  return null;
}

function selectAgent(name) {
  const url = new URL(window.location.href);
  url.searchParams.set("view", "agents");
  url.searchParams.set("agent", name);
  window.history.pushState({}, "", `${url.pathname}${url.search}`);
  render(state.board);
}

async function openCard(id, options = {}) {
  const [card, contextLayers] = await Promise.all([
    request(`/api/cards/${id}`),
    request(`/api/cards/${id}/context?all=1`),
  ]);
  const root = document.getElementById("cardDetail");
  root.replaceChildren();

  const detail = el("div", "detail");
  detail.append(
    detailHeader(card),
    handoffPanel(card),
    detailAdminActions(card),
    contextBlock(contextLayers),
    noteForm(card),
    timelineBlock(card.events),
    block("User Story", card.userStory),
    block("Problem", card.problemStatement),
    listBlock("Acceptance Criteria", card.acceptanceCriteria),
    block("Definition of Done", card.definitionOfDone),
    block("Repo", card.targetRepo),
    block("Owner", card.assignedAgent || card.expectedRole),
  );

  root.append(detail);
  if (options.updateUrl !== false) setCardParam(id);
  document.getElementById("drawer").setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  document.getElementById("drawer").setAttribute("aria-hidden", "true");
  setCardParam(null);
}

async function adminAction(action, id, body = {}) {
  await request(`/api/admin/${action}/${id}`, {
    method: "POST",
    body: JSON.stringify({ actor: "admin", ...body }),
  });
  await loadApp();
}

function detailAdminActions(card) {
  const actions = el("div", "detail-actions");
  if (card.status === "pending_approval") {
    actions.append(
      button("Approve", "action primary", () => adminAction("approve", card.id)),
      ...changeReasonButtons(card.id),
      button("Reject", "action danger", () => {
        const reason = window.prompt("Reason");
        if (reason) adminAction("reject", card.id, { reason });
      }),
    );
    return actions;
  }

  if (card.status === "testing") {
    actions.append(button("Done", "action primary", () => adminAction("done", card.id)));
    return actions;
  }

  return document.createDocumentFragment();
}

function detailHeader(card) {
  const header = el("header", "detail-hero");
  const kicker = el("div", "detail-kicker");
  kicker.append(
    el("span", "ticket-chip", `#${card.id}`),
    el("span", "", card.featureName),
    el("span", "", card.projectName),
  );
  const status = el("div", "detail-status-row");
  status.append(
    el("span", `status-chip ${card.status}`.trim(), label(card.status)),
    el("span", "priority-chip", `${card.riskLevel || "medium"} risk`),
    card.storyPoints > 0 ? el("span", "points-chip", `${card.storyPoints} pts`) : document.createDocumentFragment(),
    card.sprint ? el("span", "points-chip", card.sprint) : document.createDocumentFragment(),
  );
  header.append(kicker, el("h2", "", card.title), status);
  return header;
}

async function addCardNote(id, form) {
  const data = new FormData(form);
  const actor = String(data.get("actor") || "").trim() || "admin";
  const role = String(data.get("role") || "").trim() || "admin";
  const message = String(data.get("message") || "").trim();

  if (!message) return;

  window.localStorage.setItem("relay.actor", actor);
  window.localStorage.setItem("relay.role", role);

  await request(`/api/note/${id}`, {
    method: "POST",
    body: JSON.stringify({ actor, role, message }),
  });
  await loadApp();
  await openCard(id);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Relay-Token": window.RELAY_CONFIG.token,
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function block(title, value) {
  const node = el("section", "detail-block");
  node.append(el("h3", "", title), markdownBlock(value || "None"));
  return node;
}

function listBlock(title, values) {
  const node = el("section", "detail-block");
  const list = el("ul", "markdown-list");
  for (const value of values || []) {
    const item = el("li");
    appendInline(item, String(value));
    list.append(item);
  }
  node.append(el("h3", "", title), list);
  return node;
}

function contextBlock(layers) {
  const node = el("section", "detail-block context-section");
  const active = (layers || []).filter((layer) => !layer.supersededById);
  const superseded = (layers || []).filter((layer) => layer.supersededById);
  node.append(el("h3", "", "Context"));

  if (active.length === 0) {
    node.append(empty("No active context layers."));
  } else {
    const list = el("div", "context-list");
    for (const layer of active) list.append(contextLayerNode(layer));
    node.append(list);
  }

  if (superseded.length > 0) {
    const details = el("details", "context-history");
    details.append(el("summary", "", `${superseded.length} superseded layer${superseded.length === 1 ? "" : "s"}`));
    const list = el("div", "context-list");
    for (const layer of superseded) list.append(contextLayerNode(layer));
    details.append(list);
    node.append(details);
  }

  return node;
}

function contextLayerNode(layer) {
  const node = el("article", "context-layer");
  const head = el("div", "context-layer-head");
  head.append(
    el("span", "context-type", layerTypeLabel(layer.layerType)),
    el("strong", "", layer.title),
    el("span", "context-age", `${ageLabel(layer.createdAt)} · ${layer.actor}/${roleLabel(layer.role)}`),
  );
  node.append(head, markdownBlock(layer.bodyMarkdown || "None"));
  return node;
}

function noteForm(card) {
  const savedActor = window.localStorage.getItem("relay.actor") || "admin";
  const savedRole = window.localStorage.getItem("relay.role") || "admin";
  const form = el("form", "note-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    addCardNote(card.id, form).catch((error) => window.alert(error.message));
  });

  const actor = el("input", "field-input");
  actor.name = "actor";
  actor.value = savedActor;
  actor.autocomplete = "off";
  actor.setAttribute("aria-label", "Actor");

  const message = el("textarea", "field-input note-message");
  message.name = "message";
  message.placeholder = notePlaceholder(card.status);
  message.rows = 4;

  const fields = el("div", "note-fields");
  fields.append(field("Actor", actor), roleSegment(savedRole));
  const submit = el("button", "action primary composer-submit", "Post update");
  submit.type = "submit";
  form.append(el("h3", "", "Add Update"), el("p", "form-hint", "Markdown is supported."), fields, message, submit);
  return form;
}

function roleSegment(savedRole) {
  const wrapper = el("div", "role-segment");
  wrapper.setAttribute("role", "radiogroup");
  wrapper.setAttribute("aria-label", "Role");
  wrapper.append(el("span", "role-segment-label", "Role"));
  for (const value of ["admin", "pm", "developer", "reviewer", "tester"]) {
    const labelNode = el("label", "role-option");
    const input = el("input");
    input.type = "radio";
    input.name = "role";
    input.value = value;
    input.checked = value === savedRole;
    labelNode.append(input, el("span", "", roleLabel(value)));
    wrapper.append(labelNode);
  }
  return wrapper;
}

function field(labelText, control) {
  const wrapper = el("label", "field");
  wrapper.append(el("span", "", labelText), control);
  return wrapper;
}

function timelineBlock(events) {
  const node = el("section", "detail-block");
  const list = el("div", "timeline");
  const items = [...(events || [])].reverse();

  if (items.length === 0) {
    list.append(empty("No updates yet."));
  }

  for (const event of items) {
    const item = el("article", "timeline-item");
    item.dataset.role = event.role;
    const marker = el("span", "timeline-marker", roleInitial(event.role));
    const content = el("div", "timeline-content");
    const head = el("div", "timeline-head");
    head.append(
      el("strong", "", `${roleLabel(event.role)} · ${event.actor}`),
      el("span", "", `${actionLabel(event.action)} · ${formatTime(event.createdAt)}`),
    );
    content.append(head, markdownBlock(event.message || "No comment.", "timeline-message"));
    item.append(marker, content);
    list.append(item);
  }

  node.append(el("h3", "", "Timeline"), list);
  return node;
}

function meta(items) {
  const node = el("div", "meta");
  for (const item of items.filter(Boolean)) node.append(el("span", "pill", item));
  return node;
}

function roleChip(role) {
  return el("span", `role-chip ${role || ""}`.trim(), roleLabel(role));
}

function lintChips(warnings) {
  const node = el("div", "lint-chips");
  for (const warning of warnings) node.append(el("span", "lint-chip", warning));
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

function changeReasonButtons(cardId) {
  return [
    ...CANNED_CHANGE_REASONS.map((reason) =>
      button(shortReason(reason), "action warning", () => adminAction("changes", cardId, { reason })),
    ),
    button("Custom", "action warning", () => {
      const reason = window.prompt("Reason");
      if (reason) adminAction("changes", cardId, { reason });
    }),
  ];
}

function shortReason(reason) {
  const labels = {
    "Too big — split it": "Too big",
    "Solution-shaped — state the problem": "State problem",
    "Acceptance criteria not testable": "Criteria",
    "Missing context": "Context",
  };
  return labels[reason] || reason;
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

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function signalPreview(card) {
  const signal = handoffSignal(card);
  const node = el("div", `card-signal ${signal.tone}`.trim());
  node.append(el("span", "", signal.label), el("p", "", plainPreview(signal.text)));
  return node;
}

function handoffPanel(card) {
  const signal = handoffSignal(card);
  const node = el("section", `handoff-panel ${signal.tone}`.trim());
  node.append(el("span", "signal-label", signal.label), markdownBlock(signal.text));
  return node;
}

function handoffSignal(card) {
  const adminChange = latestEvent(card, (event) => ["admin.needs_changes", "admin.rejected"].includes(event.action));
  const adminClose = latestEvent(card, (event) => ["admin.paused", "admin.cancelled", "admin.done"].includes(event.action));
  const pmNote = latestNote(card, ["pm"]);
  const developerNote = latestNote(card, ["developer"]);
  const reviewerNote = latestNote(card, ["reviewer"]);
  const testerNote = latestNote(card, ["tester"]);
  const anyNote = latestNote(card, ["admin", "pm", "developer", "reviewer", "tester"]);

  if (card.status === "needs_changes") {
    return signal("Admin feedback", adminChange?.message || "PM needs to revise the scope before this can move forward.", "warning");
  }

  if (card.status === "pending_approval") {
    return signal("Admin decision", firstText(card.acceptanceCriteria) || card.problemStatement, "pending");
  }

  if (card.status === "ready") {
    return signal("Ready for claim", `${roleLabel(card.expectedRole)} should claim this and post an execution plan.`, "ready");
  }

  if (card.status === "in_progress") {
    return signal("Implementation update", developerNote?.message || "Developer should report progress, blockers, branch, and test status.", "active");
  }

  if (card.status === "review") {
    return signal(
      reviewerNote ? "Review finding" : "Review handoff",
      reviewerNote?.message || developerNote?.message || "Reviewer should post findings, risks, and required fixes.",
      "review",
    );
  }

  if (card.status === "testing") {
    return signal("QA evidence", testerNote?.message || reviewerNote?.message || "Tester should report scenarios covered and failures found.", "testing");
  }

  if (card.status === "done") {
    return signal("Closeout", adminClose?.message || anyNote?.message || "Work is marked done.", "done");
  }

  if (["rejected", "paused", "cancelled"].includes(card.status)) {
    return signal("Admin note", adminClose?.message || adminChange?.message || "No current execution expected.", "warning");
  }

  return signal("PM scope", pmNote?.message || firstText(card.acceptanceCriteria) || "PM should submit this for admin approval.", "draft");
}

function signal(labelText, text, tone) {
  return { label: labelText, text, tone };
}

function latestNote(card, roles) {
  return latestEvent(card, (event) => event.action === "card.note" && roles.includes(event.role));
}

function latestEvent(card, predicate) {
  const events = card.events || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return null;
}

function firstText(values) {
  if (!Array.isArray(values)) return values || "";
  return values.find(Boolean) || "";
}

function ownerChip(card) {
  const chip = el("span", `owner-chip${card.assignedAgent ? " assigned" : ""}`.trim());
  if (card.assignedAgent) {
    chip.append(presenceDot(isAgentOnline(card.assignedAgent)), el("span", "", card.assignedAgent));
    return chip;
  }

  chip.append(el("span", "", roleLabel(card.expectedRole)));
  return chip;
}

function presenceDot(online) {
  const dot = el("span", `presence-dot${online ? " online" : " offline"}`.trim());
  dot.setAttribute("aria-label", online ? "Online" : "Offline");
  return dot;
}

function isAgentOnline(name) {
  return (state.navigation?.onlineAgents || []).some((agent) => agent.agent === name);
}

function summaryText({ active, activePoints, cards, inbox, onlineCount, pending, view }) {
  if (view === "inbox") {
    const counts = inbox?.counts || { action: 0, updates: 0, waiting: 0 };
    return `Inbox · ${counts.action} need admin · ${counts.waiting} waiting · ${counts.updates} updates`;
  }

  return `${contextTitle()} · ${onlineCount} online · ${pending.length} pending · ${active.length} active · ${activePoints} pts · ${cards.length} cards`;
}

function roleLabel(role) {
  const labels = {
    admin: "Admin",
    pm: "PM",
    developer: "Developer",
    reviewer: "Reviewer",
    tester: "Tester",
  };
  return labels[role] || role;
}

function roleInitial(role) {
  return roleLabel(role).slice(0, 1);
}

function actionLabel(action) {
  const labels = {
    "admin.approved": "Approved",
    "admin.needs_changes": "Needs changes",
    "admin.rejected": "Rejected",
    "admin.paused": "Paused",
    "admin.cancelled": "Cancelled",
    "admin.done": "Done",
    "card.claimed": "Claimed",
    "card.created": "Created",
    "card.linked": "Linked",
    "card.moved": "Moved",
    "card.note": "Update",
    "card.revised": "Revised",
    "card.submitted": "Submitted",
  };
  return labels[action] || action.replaceAll(".", " ");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function ageLabel(value) {
  const date = new Date(value);
  const delta = Date.now() - date.getTime();
  if (Number.isNaN(delta)) return value;
  const minutes = Math.max(0, Math.floor(delta / 60000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function layerTypeLabel(value) {
  return String(value || "").replaceAll("_", " ");
}

function notePlaceholder(status) {
  if (status === "review") return "Markdown supported. Write review findings, risks, required fixes, and what can move to QA.";
  if (status === "testing") return "Markdown supported. Write scenarios tested, evidence, failures, and release confidence.";
  if (status === "in_progress") return "Markdown supported. Write progress, branch/PR, blockers, and what is ready for review.";
  if (status === "needs_changes") return "Markdown supported. Write the revision summary or admin clarification.";
  if (status === "pending_approval") return "Markdown supported. Write approval context, risks, or scope concerns.";
  return "Write a clear status update or admin comment. Markdown is supported.";
}

function markdownBlock(value, extraClass = "") {
  const root = el("div", `markdown ${extraClass}`.trim());
  const text = markdownText(value);
  if (!text) {
    root.append(el("p", "", "None"));
    return root;
  }

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = el("pre");
      pre.append(el("code", "", codeLines.join("\n")));
      root.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const node = el(`h${Math.min(heading[1].length + 3, 6)}`);
      appendInline(node, heading[2]);
      root.append(node);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const list = el("ul");
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        const item = el("li");
        appendInline(item, lines[index].replace(/^\s*[-*]\s+/, ""));
        list.append(item);
        index += 1;
      }
      root.append(list);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const list = el("ol");
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        const item = el("li");
        appendInline(item, lines[index].replace(/^\s*\d+\.\s+/, ""));
        list.append(item);
        index += 1;
      }
      root.append(list);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = el("blockquote");
      const parts = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        parts.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      appendInline(quote, parts.join(" "));
      root.append(quote);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBoundary(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    const node = el("p");
    appendInline(node, paragraph.join(" "));
    root.append(node);
  }

  return root;
}

function isMarkdownBoundary(line) {
  return (
    line.trim().startsWith("```") ||
    /^(#{1,4})\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>\s?/.test(line)
  );
}

function appendInline(parent, text) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  for (const match of String(text).matchAll(pattern)) {
    if (match.index > cursor) parent.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("`")) {
      parent.append(el("code", "", token.slice(1, -1)));
    } else if (token.startsWith("**")) {
      const strong = el("strong");
      strong.append(document.createTextNode(token.slice(2, -2)));
      parent.append(strong);
    } else {
      const emphasis = el("em");
      emphasis.append(document.createTextNode(token.slice(1, -1)));
      parent.append(emphasis);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parent.append(document.createTextNode(text.slice(cursor)));
}

function markdownText(value) {
  return String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .trim();
}

function plainPreview(value) {
  return markdownText(value)
    .replace(/```[\s\S]*?```/g, "code block")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function currentFilter() {
  const params = new URLSearchParams(window.location.search);
  return {
    agent: params.get("agent"),
    card: params.get("card"),
    feature: params.get("feature"),
    project: params.get("project"),
    view: params.get("view"),
  };
}

function setCardParam(id) {
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set("card", id);
  } else {
    url.searchParams.delete("card");
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

function contextTitle() {
  const filter = currentFilter();
  if (filter.view === "approvals") return "Needs Approval";
  if (filter.view === "inbox") return "Inbox";
  if (!state.navigation) return "Board";

  if (filter.feature) {
    const feature = state.navigation.features.find((item) => String(item.id) === filter.feature);
    if (feature) return feature.name;
  }

  if (filter.project) {
    for (const feature of state.navigation.features) {
      const project = feature.projects.find((item) => String(item.id) === filter.project);
      if (project) return `${feature.name} / ${project.name}`;
    }
  }

  return "All Work";
}
