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
  const cardId = currentFilter().card;
  if (cardId) openCard(cardId, { updateUrl: false }).catch((error) => window.alert(error.message));
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
  const onlineCount = state.navigation?.onlineAgents?.length || 0;

  document.getElementById("summary").textContent = `${contextTitle()} · ${onlineCount} online · ${pending.length} pending · ${active.length} active · ${activePoints} pts · ${cards.length} cards`;
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

  const heading = el("div", "card-heading");
  heading.append(el("h3", "", card.title), el("span", "owner-chip", workingAgentTag(card)));

  node.append(
    heading,
    el("p", "card-context", `${card.projectName} / ${card.featureName}`),
    signalPreview(card),
    meta([`#${card.id}`, label(card.status), `P${card.priority}`, card.storyPoints > 0 ? `${card.storyPoints}sp` : "", card.sprint]),
  );

  return node;
}

async function openCard(id, options = {}) {
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
    handoffPanel(card),
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

async function addCardNote(id, form) {
  const data = new FormData(form);
  const actor = String(data.get("actor") || "").trim() || "admin";
  const role = String(data.get("role") || "").trim() || "admin";
  const message = String(data.get("message") || "").trim();

  if (!message) return;

  window.localStorage.setItem("mistri.actor", actor);
  window.localStorage.setItem("mistri.role", role);

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

function noteForm(card) {
  const savedActor = window.localStorage.getItem("mistri.actor") || "admin";
  const savedRole = window.localStorage.getItem("mistri.role") || "admin";
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

  const role = el("select", "field-input");
  role.name = "role";
  for (const value of ["admin", "pm", "developer", "reviewer", "tester"]) {
    const option = el("option", "", roleLabel(value));
    option.value = value;
    option.selected = value === savedRole;
    role.append(option);
  }

  const message = el("textarea", "field-input note-message");
  message.name = "message";
  message.placeholder = notePlaceholder(card.status);
  message.rows = 4;

  const fields = el("div", "note-fields");
  fields.append(field("Actor", actor), field("Role", role));
  const submit = el("button", "action primary", "Add update");
  submit.type = "submit";
  form.append(el("h3", "", "Add Update"), el("p", "form-hint", "Markdown is supported."), fields, message, submit);
  return form;
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

function workingAgentTag(card) {
  if (card.assignedAgent) {
    return card.assignedAgent;
  }
  return roleLabel(card.expectedRole);
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
  const text = String(value || "").trim();
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

function plainPreview(value) {
  return String(value || "")
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
