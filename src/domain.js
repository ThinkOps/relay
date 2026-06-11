const {
  APPROVAL_STATUSES,
  BRIEF_LAYERS,
  CARD_STATUSES,
  FEATURE_STATUSES,
  LAYER_TYPES,
  RISK_LEVELS,
  ROLES,
} = require("./constants");
const { readGitMetadata } = require("./git");
const { createStore } = require("./storage");

function createRelay({ dbPath, cwd = process.cwd() }) {
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
    return {
      ...updated,
      brief: briefCard(updated.id, { role: claimingRole }),
    };
  }

  function moveCard(id, input = {}) {
    const card = requireCard(id);
    const nextStatus = enumValue(input.status, CARD_STATUSES, "Card status");
    const actingRole = role(input.role || card.assignedRole || "developer");
    assertMove(card.status, nextStatus, actingRole);
    const warnings = moveWarnings(card, nextStatus);

    if (hasText(input.handoff)) {
      upsertHandoffIntent(card, {
        actor: actor(input.actor),
        role: actingRole,
        bodyMarkdown: contextBody(input.handoff, "handoff_intent"),
      });
    }

    const updated = store.updateCardState(card.id, {
      status: nextStatus,
      approvalStatus: card.approvalStatus,
      assignedRole: card.assignedRole,
      assignedAgent: card.assignedAgent,
    });

    event(updated.id, input, "card.moved", `${card.status} -> ${nextStatus}`, {
      fromStatus: card.status,
      toStatus: nextStatus,
    });
    return {
      ...updated,
      warnings,
    };
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
    return event(card.id, input, "card.note", noteText(input.message));
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

  function addContextLayer(input = {}) {
    const scope = resolveContextScope(input);
    const layerType = contextLayerType(input.type || input.layerType);
    assertLayerScope(layerType, scope.kind);
    const actorName = actor(input.actor);
    const actorRole = role(input.role || "developer");
    const bodyMarkdown = contextBody(input.body || input.bodyMarkdown, layerType);

    const layer = store.createContextLayer({
      projectId: scope.kind === "project" ? scope.project.id : null,
      featureId: scope.kind === "feature" ? scope.feature.id : null,
      cardId: scope.kind === "card" ? scope.card.id : null,
      layerType,
      title: requiredText(input.title, "Layer title"),
      bodyMarkdown,
      actor: actorName,
      role: actorRole,
      supersedesId: input.supersedesId ? positiveInteger(input.supersedesId, "Supersedes id") : null,
    });

    const storedEvent = store.addEvent({
      cardId: layer.cardId,
      actor: actorName,
      role: actorRole,
      action: "context.added",
      message: layer.title,
      metadata: contextEventMetadata(layer),
    });

    notifyMentionedAgents(layer.cardId, storedEvent, layer.bodyMarkdown);
    return layer;
  }

  function supersedeContextLayer(id, input = {}) {
    const current = requireContextLayer(id);
    if (current.supersededById) {
      throw new Error(`Layer ${current.id} already superseded by ${current.supersededById}.`);
    }

    const actorName = actor(input.actor);
    const actorRole = role(input.role || "developer");
    const bodyMarkdown = contextBody(input.body || input.bodyMarkdown, current.layerType);
    const title = input.title === undefined ? current.title : requiredText(input.title, "Layer title");
    const metadata = contextEventMetadata({
      ...current,
      supersedesId: current.id,
    });

    const result = store.supersedeContextLayer(current.id, {
      title,
      bodyMarkdown,
      actor: actorName,
      role: actorRole,
      event: {
        cardId: current.cardId,
        actor: actorName,
        role: actorRole,
        action: "context.superseded",
        message: title,
        metadata,
      },
    });

    notifyMentionedAgents(result.layer.cardId, result.event, result.layer.bodyMarkdown);
    return result.layer;
  }

  function listContextLayers(input = {}) {
    const scope = resolveContextScope(input);
    const layerType = input.type || input.layerType ? contextLayerType(input.type || input.layerType) : "";
    return store.listContextLayers({
      projectId: scope.kind === "project" ? scope.project.id : null,
      featureId: scope.kind === "feature" ? scope.feature.id : null,
      cardId: scope.kind === "card" ? scope.card.id : null,
      layerType,
      includeSuperseded: Boolean(input.includeSuperseded),
    });
  }

  function getContextLayer(id) {
    return requireContextLayer(id);
  }

  function briefCard(id, input = {}) {
    const card = requireCard(id);
    const actingRole = role(input.role || card.assignedRole || card.expectedRole);
    const events = store.listEvents(card.id);
    const layers = {};

    for (const layerType of BRIEF_LAYERS[actingRole]) {
      const layer = latestBriefLayer(card, layerType);
      if (layer) layers[layerType] = layer;
    }

    return {
      card,
      layers,
      decisions: events.filter((item) => item.action.startsWith("admin.")).map(briefEvent),
      recentEvents: events.slice(-5).map(briefEvent),
      nextAction: nextBriefAction(card, actingRole),
    };
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

  function listAgentNotifications(input = {}) {
    const targetAgent = requiredText(input.agent || input.actor, "Agent");
    const targetRole = notificationRole(input.role, targetAgent);
    return store.listNotifications({
      agent: targetAgent,
      role: targetRole,
      unread: Boolean(input.unread),
    });
  }

  function acknowledgeNotification(id, input = {}) {
    const targetAgent = requiredText(input.agent || input.actor, "Agent");
    const targetRole = notificationRole(input.role, targetAgent);
    const notification = store.acknowledgeNotification({
      id: positiveInteger(id, "Notification id"),
      agent: targetAgent,
      role: targetRole,
    });

    if (!notification) {
      throw new Error(`Notification not found for ${targetAgent}.`);
    }

    return notification;
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

  function resolveContextScope(input) {
    const hasCard = hasText(input.card);
    const hasFeature = hasText(input.feature);
    const hasProject = hasText(input.project);

    if (hasCard && (hasFeature || hasProject)) {
      throw new Error("Context layer scope must be exactly one of project, feature, or card.");
    }

    if (hasCard) {
      return { kind: "card", card: requireCard(input.card) };
    }

    if (hasFeature) {
      const parsed = parseFeatureScope(input.project, input.feature);
      const project = resolveProject(parsed.project);
      const feature = resolveFeature(project.id, parsed.feature);
      return { kind: "feature", project, feature };
    }

    if (hasProject) {
      return { kind: "project", project: resolveProject(input.project) };
    }

    throw new Error("Context layer scope must be exactly one of project, feature, or card.");
  }

  function parseFeatureScope(projectValue, featureValue) {
    const featureText = requiredText(featureValue, "Feature");
    if (hasText(projectValue)) {
      return { project: projectValue, feature: featureText };
    }

    const separator = featureText.indexOf(":");
    if (separator > 0 && separator < featureText.length - 1) {
      return {
        project: featureText.slice(0, separator),
        feature: featureText.slice(separator + 1),
      };
    }

    throw new Error("Feature context scope requires --project or --feature project:feature.");
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

  function requireContextLayer(id) {
    const layerId = positiveInteger(id, "Layer id");
    const layer = store.getContextLayerById(layerId);
    if (!layer) throw new Error(`Layer not found: ${layerId}`);
    return layer;
  }

  function latestBriefLayer(card, layerType) {
    const scopes = [{ cardId: card.id }, { featureId: card.featureId }, { projectId: card.projectId }];
    for (const scope of scopes) {
      const [layer] = store.listContextLayers({ ...scope, layerType });
      if (layer) return layer;
    }
    return null;
  }

  function upsertHandoffIntent(card, input) {
    const title = "Handoff intent";
    const [active] = store.listContextLayers({ cardId: card.id, layerType: "handoff_intent" });

    if (active) {
      const result = store.supersedeContextLayer(active.id, {
        title,
        bodyMarkdown: input.bodyMarkdown,
        actor: input.actor,
        role: input.role,
        event: {
          cardId: card.id,
          actor: input.actor,
          role: input.role,
          action: "context.superseded",
          message: title,
          metadata: contextEventMetadata({
            ...active,
            supersedesId: active.id,
          }),
        },
      });
      notifyMentionedAgents(result.layer.cardId, result.event, result.layer.bodyMarkdown);
      return result.layer;
    }

    const layer = store.createContextLayer({
      projectId: null,
      featureId: null,
      cardId: card.id,
      layerType: "handoff_intent",
      title,
      bodyMarkdown: input.bodyMarkdown,
      actor: input.actor,
      role: input.role,
      supersedesId: null,
    });
    const storedEvent = store.addEvent({
      cardId: card.id,
      actor: input.actor,
      role: input.role,
      action: "context.added",
      message: title,
      metadata: contextEventMetadata(layer),
    });
    notifyMentionedAgents(layer.cardId, storedEvent, layer.bodyMarkdown);
    return layer;
  }

  function moveWarnings(card, nextStatus) {
    const warnings = [];
    if (card.status === "in_progress" && nextStatus === "review" && !latestBriefLayer(card, "implementation_notes")) {
      warnings.push(`Card #${card.id} has no implementation_notes; the reviewer will lack context.`);
    }
    if (card.status === "review" && nextStatus === "testing" && !latestBriefLayer(card, "validation_evidence")) {
      warnings.push(`Card #${card.id} has no validation_evidence; the tester will lack context.`);
    }
    return warnings;
  }

  function event(cardId, input, action, message, metadata) {
    const storedEvent = store.addEvent({
      cardId,
      actor: actor(input.actor),
      role: role(input.role || "admin"),
      action,
      message,
      metadata: metadata || input.metadata || {},
    });

    if (cardId) notifyForEvent(cardId, storedEvent);
    return storedEvent;
  }

  function notifyMentionedAgents(cardId, storedEvent, text) {
    if (!cardId) return;

    for (const targetAgent of new Set(mentionedAgents(text))) {
      if (targetAgent === storedEvent.actor) continue;
      store.addNotification({
        eventId: storedEvent.id,
        cardId,
        targetAgent,
        targetRole: "",
      });
    }
  }

  function notifyForEvent(cardId, storedEvent) {
    const card = store.getCardById(cardId);
    if (!card) return;

    const events = store.listEvents(cardId);
    for (const target of notificationTargets(card, storedEvent, events)) {
      store.addNotification({
        eventId: storedEvent.id,
        cardId,
        targetAgent: target.agent,
        targetRole: target.role,
      });
    }
  }

  function notificationTargets(card, storedEvent, events) {
    const targets = new Map();
    const addTarget = ({ agent = "", role: targetRole = "" }) => {
      const targetAgent = optionalText(agent);
      const normalizedRole = targetRole ? role(targetRole) : "";
      if (!targetAgent && !normalizedRole) return;
      if (targetAgent && targetAgent === storedEvent.actor) return;
      if (!targetAgent && normalizedRole === storedEvent.role) return;
      targets.set(`${targetAgent}|${normalizedRole}`, { agent: targetAgent, role: normalizedRole });
    };
    const addAssignedTarget = () => {
      if (card.assignedAgent) {
        addTarget({ agent: card.assignedAgent, role: card.assignedRole });
        return;
      }
      addTarget({ role: card.expectedRole });
    };
    const addPmTarget = () => {
      const pmAgent = pmAgentFor(events);
      if (pmAgent) {
        addTarget({ agent: pmAgent, role: "pm" });
        return;
      }
      addTarget({ role: "pm" });
    };

    for (const mention of mentionedAgents(storedEvent.message)) addTarget({ agent: mention });

    if (storedEvent.action === "card.note") {
      if (storedEvent.role === "admin") {
        if (card.assignedAgent) addAssignedTarget();
        else addPmTarget();
      } else if (["pm", "reviewer", "tester"].includes(storedEvent.role) && card.assignedAgent) {
        addAssignedTarget();
      }
    }

    if (["admin.needs_changes", "admin.rejected"].includes(storedEvent.action)) addPmTarget();
    if (["admin.approved", "admin.paused", "admin.cancelled", "admin.done"].includes(storedEvent.action)) {
      addAssignedTarget();
    }

    if (storedEvent.action === "card.moved") {
      const fromStatus = storedEvent.metadata.fromStatus;
      const toStatus = storedEvent.metadata.toStatus;
      if (toStatus === "review") addTarget({ role: "reviewer" });
      if (toStatus === "testing") addTarget({ role: "tester" });
      if (toStatus === "in_progress" && ["review", "testing"].includes(fromStatus)) addAssignedTarget();
    }

    if (["card.revised", "card.submitted"].includes(storedEvent.action) && card.assignedAgent) {
      addAssignedTarget();
    }

    return Array.from(targets.values());
  }

  function notificationRole(inputRole, targetAgent) {
    if (inputRole) return role(inputRole);
    return store.getAgentHeartbeat(targetAgent)?.role || "";
  }

  function pmAgentFor(events) {
    const pmEvent = events.find(
      (item) => item.role === "pm" && ["card.created", "card.submitted", "card.revised"].includes(item.action),
    );
    return pmEvent?.actor || "";
  }

  return {
    addNote,
    addContextLayer,
    acknowledgeNotification,
    approveCard,
    briefCard,
    board,
    cancelCard,
    claimCard,
    close,
    completeCard,
    createCard,
    createFeature,
    createProject,
    getCard,
    getContextLayer,
    heartbeat,
    linkCard,
    listAgentNotifications,
    listCards,
    listContextLayers,
    listFeatures: store.listFeatures,
    listOnlineAgents,
    listProjects: store.listProjects,
    moveCard,
    pauseCard,
    rejectCard,
    requestChanges,
    reviseCard,
    submitCard,
    supersedeContextLayer,
  };
}

function requiredText(value, label) {
  const text = optionalText(value);
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > 5000) throw new Error(`${label} is too long.`);
  return text;
}

function noteText(value) {
  return requiredText(value, "Note").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
}

function optionalText(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function hasText(value) {
  return optionalText(value) !== "";
}

function contextLayerType(value) {
  const normalized = optionalText(value).toLowerCase();
  const allowed = Object.keys(LAYER_TYPES);
  if (!allowed.includes(normalized)) {
    throw new Error(`Layer type must be one of: ${allowed.join(", ")}.`);
  }
  return normalized;
}

function assertLayerScope(layerType, scope) {
  const allowed = LAYER_TYPES[layerType].scopes;
  if (!allowed.includes(scope)) {
    throw new Error(`${layerType} can only be scoped to: ${allowed.join(", ")}.`);
  }
}

function contextBody(value, layerType) {
  const body = optionalText(value).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  if (!body) throw new Error("Layer body is required.");

  const max = LAYER_TYPES[layerType].bodyMax;
  if (body.length > max) {
    throw new Error(`${layerType} body exceeds ${max} chars (got ${body.length}). Summarize.`);
  }

  return body;
}

function contextEventMetadata(layer) {
  return {
    layerId: layer.id,
    layerType: layer.layerType,
    scope: layer.scope,
    projectId: layer.projectId,
    featureId: layer.featureId,
    cardId: layer.cardId,
    supersedesId: layer.supersedesId,
  };
}

function briefEvent(event) {
  return {
    action: event.action,
    message: event.message,
    actor: event.actor,
    role: event.role,
    createdAt: event.createdAt,
  };
}

function nextBriefAction(card, actingRole) {
  const actions = {
    ready: {
      developer: `Claim this card with relay claim ${card.id} --role developer, then read project_map before exploring the repo.`,
    },
    in_progress: {
      developer: "Work from the acceptance criteria, then write implementation_notes and move the card to review.",
    },
    review: {
      reviewer: "Check implementation_notes against the acceptance criteria, then move to testing or back to in_progress.",
    },
    testing: {
      tester: "Verify validation_evidence claims, then move back to in_progress or wait for admin to mark done.",
      admin: "Review validation_evidence and tester updates before marking the card done.",
    },
    needs_changes: {
      pm: "Revise the card against admin feedback, then resubmit it for approval.",
    },
    pending_approval: {
      admin: "Approve, request changes, or reject this card from the admin queue.",
    },
  };

  return actions[card.status]?.[actingRole] || `Review the card status (${card.status}) and use relay help for allowed next moves.`;
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

function positiveInteger(value, label) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isInteger(number) || number < 1 || String(number) !== String(value)) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

function mentionedAgents(value) {
  return Array.from(String(value || "").matchAll(/@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/g), (match) => match[1]);
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
  createRelay,
};
