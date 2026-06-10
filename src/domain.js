const { APPROVAL_STATUSES, CARD_STATUSES, FEATURE_STATUSES, RISK_LEVELS, ROLES } = require("./constants");
const { readGitMetadata } = require("./git");
const { createStore } = require("./storage");

function createMistri({ dbPath, cwd = process.cwd() }) {
  const store = createStore(dbPath);
  const ONLINE_WINDOW_MS = 5 * 60 * 1000;

  function createProject(input) {
    const name = requiredText(input.name, "Project name");
    const git = readGitMetadata(cwd);

    const project = store.createProject({
      name,
      description: optionalText(input.description),
      repoPath: optionalText(input.repoPath) || git.repoPath,
      repoRemote: optionalText(input.repoRemote) || git.remoteUrl,
    });

    store.addEvent({
      actor: actor(input.actor),
      role: role(input.role || "admin"),
      action: "project.created",
      message: project.name,
      metadata: { projectId: project.id },
    });

    return project;
  }

  function createFeature(input) {
    const project = resolveProject(input.project);
    const feature = store.createFeature({
      projectId: project.id,
      name: requiredText(input.name, "Feature name"),
      summary: optionalText(input.summary),
      status: enumValue(input.status || "active", FEATURE_STATUSES, "Feature status"),
    });

    store.addEvent({
      actor: actor(input.actor),
      role: role(input.role || "pm"),
      action: "feature.created",
      message: feature.name,
      metadata: { projectId: project.id, featureId: feature.id },
    });

    return feature;
  }

  function createCard(input) {
    const project = resolveProject(input.project);
    const feature = resolveFeature(project.id, input.feature);
    const git = readGitMetadata(cwd);
    const card = store.createCard({
      projectId: project.id,
      featureId: feature.id,
      title: requiredText(input.title, "Card title"),
      userStory: optionalText(input.userStory),
      problemStatement: requiredText(input.problemStatement, "Problem statement"),
      acceptanceCriteria: acceptanceCriteria(input.acceptanceCriteria),
      definitionOfDone: requiredText(input.definitionOfDone, "Definition of done"),
      targetRepo: requiredText(input.targetRepo || git.remoteUrl || git.repoPath, "Target repo"),
      expectedRole: role(input.expectedRole || "developer"),
      riskLevel: enumValue(input.riskLevel || "medium", RISK_LEVELS, "Risk level"),
      storyPoints: storyPoints(input.storyPoints),
      sprint: optionalText(input.sprint),
      status: "draft",
      approvalStatus: "draft",
      priority: priority(input.priority),
      branch: git.branch,
      commitSha: git.commitSha,
      createdByRole: role(input.createdByRole || input.role || "pm"),
    });

    store.addEvent({
      cardId: card.id,
      actor: actor(input.actor),
      role: role(input.role || "pm"),
      action: "card.created",
      message: card.title,
      metadata: { dirty: git.dirty },
    });

    return card;
  }

  function submitCard(id, input = {}) {
    const card = requireCard(id);
    assertRole(input.role || "pm", ["pm", "admin"], "Only PM or admin can submit cards.");
    assertStatus(card.status, ["draft", "needs_changes"], "Only draft or needs-changes cards can be submitted.");

    const updated = store.updateCardState(card.id, {
      status: "pending_approval",
      approvalStatus: "pending",
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "card.submitted", "Submitted for admin approval");
    return updated;
  }

  function reviseCard(id, input = {}) {
    const card = requireCard(id);
    assertRole(input.role || "pm", ["pm", "admin"], "Only PM or admin can revise cards.");
    assertStatus(card.status, ["draft", "needs_changes"], "Only draft or needs-changes cards can be revised.");

    const revisedFields = revisionFields(input);
    const message = optionalText(input.message || input.note);
    if (revisedFields.length === 0 && !message) {
      throw new Error("At least one revised field or note is required.");
    }

    const updated = store.updateCardScope(card.id, {
      title: valueOrCurrent(input.title, card.title, (value) => requiredText(value, "Card title")),
      userStory: valueOrCurrent(input.userStory, card.userStory, optionalText),
      problemStatement: valueOrCurrent(input.problemStatement, card.problemStatement, (value) =>
        requiredText(value, "Problem statement"),
      ),
      acceptanceCriteria: Object.hasOwn(input, "acceptanceCriteria")
        ? acceptanceCriteria(input.acceptanceCriteria)
        : card.acceptanceCriteria,
      definitionOfDone: valueOrCurrent(input.definitionOfDone, card.definitionOfDone, (value) =>
        requiredText(value, "Definition of done"),
      ),
      targetRepo: valueOrCurrent(input.targetRepo, card.targetRepo, (value) => requiredText(value, "Target repo")),
      expectedRole: valueOrCurrent(input.expectedRole, card.expectedRole, role),
      riskLevel: valueOrCurrent(input.riskLevel, card.riskLevel, (value) =>
        enumValue(value, RISK_LEVELS, "Risk level"),
      ),
      storyPoints: valueOrCurrent(input.storyPoints, card.storyPoints, storyPoints),
      sprint: valueOrCurrent(input.sprint, card.sprint, optionalText),
      priority: valueOrCurrent(input.priority, card.priority, priority),
    });

    event(updated.id, input, "card.revised", message || `Revised ${revisedFields.join(", ")}`, {
      revisedFields,
    });

    if (input.submit) {
      return submitCard(updated.id, { actor: input.actor, role: input.role || "pm" });
    }

    return updated;
  }

  function approveCard(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    assertStatus(card.status, ["pending_approval"], "Only pending cards can be approved.");

    const updated = store.updateCardState(card.id, {
      status: "ready",
      approvalStatus: "approved",
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.approved", input.message || "Approved");
    return updated;
  }

  function requestChanges(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    assertStatus(card.status, ["pending_approval"], "Only pending cards can be sent back for changes.");
    const reason = requiredText(input.reason, "Reason");

    const updated = store.updateCardState(card.id, {
      status: "needs_changes",
      approvalStatus: "needs_changes",
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.needs_changes", reason);
    return updated;
  }

  function rejectCard(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    assertStatus(card.status, ["pending_approval"], "Only pending cards can be rejected.");
    const reason = requiredText(input.reason, "Reason");

    const updated = store.updateCardState(card.id, {
      status: "rejected",
      approvalStatus: "rejected",
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.rejected", reason);
    return updated;
  }

  function claimCard(id, input = {}) {
    const card = requireCard(id);
    const claimingRole = role(input.role || card.expectedRole);
    assertStatus(card.status, ["ready"], "Only ready cards can be claimed.");
    if (claimingRole !== card.expectedRole && claimingRole !== "admin") {
      throw new Error(`Card expects ${card.expectedRole}, not ${claimingRole}.`);
    }

    const updated = store.updateCardState(card.id, {
      status: "in_progress",
      approvalStatus: card.approvalStatus,
      assignedRole: claimingRole,
      assignedAgent: requiredText(input.agent || input.actor, "Agent"),
    });

    heartbeat({ agent: updated.assignedAgent, role: updated.assignedRole });
    event(updated.id, input, "card.claimed", `${updated.assignedAgent} claimed as ${claimingRole}`);
    return updated;
  }

  function moveCard(id, input = {}) {
    const card = requireCard(id);
    const nextStatus = enumValue(input.status, CARD_STATUSES, "Card status");
    const actingRole = role(input.role || card.assignedRole || "developer");
    assertMove(card.status, nextStatus, actingRole);

    const updated = store.updateCardState(card.id, {
      status: nextStatus,
      approvalStatus: card.approvalStatus,
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "card.moved", `${card.status} -> ${nextStatus}`);
    return updated;
  }

  function pauseCard(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    const updated = store.updateCardState(card.id, {
      status: "paused",
      approvalStatus: card.approvalStatus,
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.paused", input.reason || "Paused by admin");
    return updated;
  }

  function cancelCard(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    const updated = store.updateCardState(card.id, {
      status: "cancelled",
      approvalStatus: card.approvalStatus,
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.cancelled", input.reason || "Cancelled by admin");
    return updated;
  }

  function completeCard(id, input = {}) {
    const card = requireCard(id);
    assertAdmin(input.role);
    assertStatus(card.status, ["testing"], "Only cards in testing can be marked done.");
    const updated = store.updateCardState(card.id, {
      status: "done",
      approvalStatus: card.approvalStatus,
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "admin.done", input.message || "Marked done");
    return updated;
  }

  function addNote(id, input = {}) {
    const card = requireCard(id);
    return event(card.id, input, "card.note", requiredText(input.message, "Note"));
  }

  function linkCard(id, input = {}) {
    const card = requireCard(id);
    const updated = store.updateCardLinks(card.id, {
      branch: optionalText(input.branch) || card.branch,
      commitSha: optionalText(input.commitSha) || card.commitSha,
      prUrl: optionalText(input.prUrl) || card.prUrl,
    });

    event(updated.id, input, "card.linked", "Updated git links");
    return updated;
  }

  function getCard(id) {
    const card = requireCard(id);
    return {
      ...card,
      events: store.listEvents(card.id),
    };
  }

  function listCards(filters = {}) {
    return store.listCards(filters);
  }

  function board(filters = {}) {
    const cards = listCards(filters);
    return CARD_STATUSES.reduce((groups, status) => {
      groups[status] = cards.filter((card) => card.status === status);
      return groups;
    }, {});
  }

  function heartbeat(input = {}) {
    return store.upsertAgentHeartbeat({
      agent: requiredText(input.agent || input.actor, "Agent"),
      role: role(input.role || "developer"),
    });
  }

  function listOnlineAgents(input = {}) {
    const windowMs = onlineWindowMs(input.windowMs || ONLINE_WINDOW_MS);
    const cutoffIso = new Date(Date.now() - windowMs).toISOString();
    return store.listOnlineAgents(cutoffIso);
  }

  function close() {
    store.close();
  }

  function resolveProject(value) {
    const name = requiredText(value, "Project");
    const project = store.getProjectByName(name);
    if (!project) throw new Error(`Project not found: ${name}`);
    return project;
  }

  function resolveFeature(projectId, value) {
    const name = requiredText(value, "Feature");
    const feature = store.getFeatureByName(projectId, name);
    if (!feature) throw new Error(`Feature not found: ${name}`);
    return feature;
  }

  function requireCard(id) {
    const cardId = Number.parseInt(String(id), 10);
    if (!Number.isInteger(cardId) || cardId < 1) {
      throw new Error("Card id must be a positive integer.");
    }

    const card = store.getCardById(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);
    return card;
  }

  function event(cardId, input, action, message, metadata) {
    return store.addEvent({
      cardId,
      actor: actor(input.actor),
      role: role(input.role || "admin"),
      action,
      message,
      metadata: metadata || input.metadata || {},
    });
  }

  return {
    addNote,
    approveCard,
    board,
    cancelCard,
    claimCard,
    close,
    completeCard,
    createCard,
    createFeature,
    createProject,
    getCard,
    heartbeat,
    linkCard,
    listCards,
    listFeatures: store.listFeatures,
    listOnlineAgents,
    listProjects: store.listProjects,
    moveCard,
    pauseCard,
    rejectCard,
    requestChanges,
    reviseCard,
    submitCard,
  };
}

function requiredText(value, label) {
  const text = optionalText(value);
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > 5000) throw new Error(`${label} is too long.`);
  return text;
}

function optionalText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function acceptanceCriteria(value) {
  const criteria = Array.isArray(value)
    ? value.map(optionalText).filter(Boolean)
    : optionalText(value)
        .split(/\n|;/)
        .map(optionalText)
        .filter(Boolean);

  if (criteria.length === 0) {
    throw new Error("At least one acceptance criterion is required.");
  }

  return criteria;
}

function enumValue(value, allowed, label) {
  const normalized = optionalText(value).toLowerCase();
  if (!allowed.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function role(value) {
  return enumValue(value || "admin", ROLES, "Role");
}

function actor(value) {
  return optionalText(value) || process.env.USER || "unknown";
}

function priority(value) {
  if (value === undefined || value === null || value === "") return 3;
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    throw new Error("Priority must be an integer from 1 to 5.");
  }
  return number;
}

function storyPoints(value) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 0 || number > 100) {
    throw new Error("Story points must be an integer from 0 to 100.");
  }
  return number;
}

function onlineWindowMs(value) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 1000 || number > 24 * 60 * 60 * 1000) {
    throw new Error("Online window must be between 1000ms and 86400000ms.");
  }
  return number;
}

function valueOrCurrent(value, current, normalize) {
  if (value === undefined) return current;
  return normalize(value);
}

function revisionFields(input) {
  return [
    ["title", "title"],
    ["userStory", "story"],
    ["problemStatement", "problem"],
    ["acceptanceCriteria", "acceptanceCriteria"],
    ["definitionOfDone", "definitionOfDone"],
    ["targetRepo", "targetRepo"],
    ["expectedRole", "expectedRole"],
    ["riskLevel", "riskLevel"],
    ["storyPoints", "storyPoints"],
    ["sprint", "sprint"],
    ["priority", "priority"],
  ]
    .filter(([key]) => Object.hasOwn(input, key))
    .map(([, label]) => label);
}

function assertRole(value, allowed, message) {
  const normalized = role(value);
  if (!allowed.includes(normalized)) throw new Error(message);
}

function assertAdmin(value) {
  assertRole(value || "admin", ["admin"], "Only admin can perform this action.");
}

function assertStatus(current, allowed, message) {
  if (!allowed.includes(current)) throw new Error(message);
}

function assertMove(current, next, actingRole) {
  if (actingRole === "admin") return;

  const allowed = {
    in_progress: {
      review: ["developer"],
    },
    review: {
      in_progress: ["reviewer"],
      testing: ["reviewer"],
    },
    testing: {
      in_progress: ["tester"],
    },
  };

  const roles = allowed[current]?.[next] || [];
  if (!roles.includes(actingRole)) {
    throw new Error(`Role ${actingRole} cannot move a card from ${current} to ${next}.`);
  }
}

module.exports = {
  createMistri,
};
