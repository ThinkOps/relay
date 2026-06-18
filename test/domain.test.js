const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const test = require("node:test");
const { createRelay } = require("../src/domain");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  return path.join(dir, "relay.db");
}

function seededApp() {
  const app = createRelay({ dbPath: tempDb(), cwd: process.cwd() });
  app.createFeature({
    name: "Login Revamp",
    summary: "Improve login flows",
    actor: "pm-agent",
    role: "pm",
  });
  app.createProject({ feature: "Login Revamp", name: "Mobile App", actor: "admin", role: "admin" });
  return app;
}

test("admin approval gates card execution", () => {
  const app = seededApp();

  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Add password reset",
    userStory: "As a locked-out user, I want to reset my password so I can recover access.",
    problemStatement: "Users need to recover accounts without support.",
    acceptanceCriteria: ["User can request reset email", "Expired tokens are rejected"],
    definitionOfDone: "Reset flow works and is tested.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    storyPoints: 5,
    sprint: "Sprint 1",
    actor: "pm-agent",
    role: "pm",
  });

  assert.equal(card.status, "draft");
  assert.equal(card.userStory, "As a locked-out user, I want to reset my password so I can recover access.");
  assert.equal(card.storyPoints, 5);
  assert.equal(card.sprint, "Sprint 1");
  assert.throws(() => app.claimCard(card.id, { role: "developer", agent: "dev-agent" }), /ready/);

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  const approved = app.approveCard(card.id, { actor: "aditya", role: "admin" });

  assert.equal(approved.status, "ready");
  assert.equal(approved.approvalStatus, "approved");

  const claimed = app.claimCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    agent: "dev-agent",
  });

  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.assignedAgent, "dev-agent");
  assert.equal(app.listOnlineAgents()[0].agent, "dev-agent");

  app.close();
});

test("admin can request changes with an event trail", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Clarify reset scope",
    problemStatement: "Scope is unclear.",
    acceptanceCriteria: "PM writes edge cases",
    definitionOfDone: "Admin can approve after edge cases are added.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  const changed = app.requestChanges(card.id, {
    actor: "aditya",
    role: "admin",
    reason: "Add token expiry and invalid token behavior.",
  });
  const detail = app.getCard(card.id);

  assert.equal(changed.status, "needs_changes");
  assert.equal(detail.events.at(-1).action, "admin.needs_changes");
  assert.match(detail.events.at(-1).message, /token expiry/);

  app.close();
});

test("admin can send a ready approved card back for changes", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Amend approved copy",
    problemStatement: "Approved cards can still contain copy or scope mistakes.",
    acceptanceCriteria: "Admin can send ready work back before it is claimed",
    definitionOfDone: "PM can revise and resubmit.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  const changed = app.requestChanges(card.id, {
    actor: "aditya",
    role: "admin",
    reason: "Fix the acceptance criteria before developers claim this.",
  });

  assert.equal(changed.status, "needs_changes");
  assert.equal(changed.approvalStatus, "needs_changes");
  assert.equal(app.getCard(card.id).events.at(-1).action, "admin.needs_changes");

  app.close();
});

test("agent notes normalize escaped markdown line breaks", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Report review findings",
    problemStatement: "Review notes need readable Markdown.",
    acceptanceCriteria: "Timeline renders headings and bullets",
    definitionOfDone: "Admin can read the agent update.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "reviewer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.addNote(card.id, {
    actor: "review-agent",
    role: "reviewer",
    message: "## Findings\\n- Missing error path\\n- Add integration test",
  });
  const detail = app.getCard(card.id);

  assert.equal(detail.events.at(-1).message, "## Findings\n- Missing error path\n- Add integration test");

  app.close();
});

test("pm can revise a needs-changes card and resubmit it", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Clarify reset scope",
    problemStatement: "Scope is unclear.",
    acceptanceCriteria: "PM writes edge cases",
    definitionOfDone: "Admin can approve after edge cases are added.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.requestChanges(card.id, {
    actor: "aditya",
    role: "admin",
    reason: "Add token expiry and invalid token behavior.",
  });

  const revised = app.reviseCard(card.id, {
    actor: "pm-agent",
    role: "pm",
    acceptanceCriteria: ["PM writes edge cases", "Expired tokens are rejected"],
    definitionOfDone: "Admin can approve after expiry and invalid-token behavior are specified.",
    storyPoints: 3,
    message: "Added expiry and invalid-token criteria.",
    submit: true,
  });
  const detail = app.getCard(card.id);
  const revisedEvent = detail.events.find((event) => event.action === "card.revised");

  assert.equal(revised.status, "pending_approval");
  assert.equal(revised.approvalStatus, "pending");
  assert.deepEqual(revised.acceptanceCriteria, ["PM writes edge cases", "Expired tokens are rejected"]);
  assert.equal(revised.storyPoints, 3);
  assert.equal(revisedEvent.message, "Added expiry and invalid-token criteria.");
  assert.deepEqual(revisedEvent.metadata.revisedFields, [
    "acceptanceCriteria",
    "definitionOfDone",
    "storyPoints",
  ]);
  assert.equal(detail.events.at(-1).action, "card.submitted");

  app.close();
});

test("card revise preserves expected role when role flag is omitted", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Keep developer claimable",
    problemStatement: "Needs-changes revisions must not turn developer work into PM work.",
    acceptanceCriteria: "Developer can still claim after PM revises without a role flag",
    definitionOfDone: "Approved card remains claimable by a developer.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.requestChanges(card.id, {
    actor: "aditya",
    role: "admin",
    reason: "Acceptance criteria need one more pass.",
  });

  const revised = app.reviseCard(card.id, {
    actor: "pm-agent",
    role: "pm",
    problemStatement: "Needs-changes revisions must preserve the expected implementation role.",
    acceptanceCriteria: ["Developer can still claim after PM revises without a role flag"],
    submit: true,
  });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  const approved = app.getCard(card.id);
  const claimed = app.claimCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    agent: "dev-agent",
  });

  assert.equal(revised.expectedRole, "developer");
  assert.equal(approved.expectedRole, "developer");
  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.assignedAgent, "dev-agent");

  app.close();
});

test("approved cards cannot be revised silently", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Ship reset tests",
    problemStatement: "Reset flow needs verification.",
    acceptanceCriteria: "Tests cover happy and failure paths",
    definitionOfDone: "Admin sees passing tester notes.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "high",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });

  assert.throws(
    () =>
      app.reviseCard(card.id, {
        actor: "pm-agent",
        role: "pm",
        acceptanceCriteria: "Changed after approval",
      }),
    /Only draft or needs-changes cards can be revised/,
  );

  app.close();
});

test("agent heartbeat marks agents online", () => {
  const app = seededApp();

  const heartbeat = app.heartbeat({
    agent: "dev-agent",
    role: "developer",
  });
  const online = app.listOnlineAgents();

  assert.equal(heartbeat.agent, "dev-agent");
  assert.equal(heartbeat.role, "developer");
  assert.equal(online.length, 1);
  assert.equal(online[0].agent, "dev-agent");

  app.close();
});

test("admin can unclaim active work for dead-agent recovery", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Recover abandoned work",
    problemStatement: "Agents can die after claiming work.",
    acceptanceCriteria: "Admin can release the claim and a replacement can claim",
    definitionOfDone: "Replacement agent receives the card brief.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  app.claimCard(card.id, {
    actor: "dead-agent",
    role: "developer",
    agent: "dead-agent",
  });

  assert.throws(
    () => app.claimCard(card.id, { actor: "replacement", role: "developer", agent: "replacement" }),
    /Only ready cards can be claimed/,
  );

  const unclaimed = app.unclaimCard(card.id, { actor: "aditya", role: "admin" });
  const replacement = app.claimCard(card.id, {
    actor: "replacement",
    role: "developer",
    agent: "replacement",
  });
  const unclaimEvent = app.getCard(card.id).events.find((event) => event.action === "admin.unclaimed");

  assert.equal(unclaimed.status, "ready");
  assert.equal(unclaimed.assignedAgent, "");
  assert.equal(replacement.assignedAgent, "replacement");
  assert.equal(replacement.status, "in_progress");
  assert.equal(unclaimEvent.metadata.previousAgent, "dead-agent");

  app.close();
});

test("admin comments create agent notifications that can be acknowledged", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Implement reset validation",
    problemStatement: "Validation failures need clear handling.",
    acceptanceCriteria: "Developer handles invalid reset tokens",
    definitionOfDone: "Admin sees implementation evidence.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  app.claimCard(card.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  app.addNote(card.id, {
    actor: "aditya",
    role: "admin",
    message: "Please include the expired token path.",
  });

  const inbox = app.listAgentNotifications({ agent: "dev-agent", unread: true });
  const comment = inbox.find((item) => item.event.action === "card.note");

  assert.equal(comment.targetAgent, "dev-agent");
  assert.equal(comment.card.title, "Implement reset validation");
  assert.match(comment.event.message, /expired token/);
  assert.throws(() => app.acknowledgeNotification(comment.id, { agent: "other-agent" }), /not found/);

  const acknowledged = app.acknowledgeNotification(comment.id, { agent: "dev-agent" });
  assert.ok(acknowledged.readAt);
  assert.equal(
    app.listAgentNotifications({ agent: "dev-agent", unread: true }).some((item) => item.id === comment.id),
    false,
  );

  app.close();
});

test("review send-backs notify the assigned developer", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Review reset implementation",
    problemStatement: "Code review can require developer follow-up.",
    acceptanceCriteria: "Reviewer can send work back with findings",
    definitionOfDone: "Developer sees the send-back notification.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  app.claimCard(card.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: review reset implementation. Claimed fix: implementation is ready for reviewer checks.",
  });
  app.moveCard(card.id, { actor: "review-agent", role: "reviewer", status: "in_progress" });

  const inbox = app.listAgentNotifications({ agent: "dev-agent", unread: true });
  const sendBack = inbox.find(
    (item) => item.event.action === "card.moved" && item.event.message === "review -> in_progress",
  );

  assert.equal(sendBack.targetAgent, "dev-agent");
  assert.equal(sendBack.card.status, "in_progress");

  app.close();
});

test("mentions notify exact agents", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Coordinate reset QA",
    problemStatement: "QA needs direct attention.",
    acceptanceCriteria: "Mentioned agents receive notifications",
    definitionOfDone: "Mentioned QA agent can see the notification.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  app.addNote(card.id, {
    actor: "aditya",
    role: "admin",
    message: "@qa-agent please verify the reset copy.",
  });
  const inbox = app.listAgentNotifications({ agent: "qa-agent", unread: true });

  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].targetAgent, "qa-agent");
  assert.match(inbox[0].event.message, /verify the reset copy/);

  app.close();
});

test("only admin can mark cards done", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Ship reset tests",
    problemStatement: "Reset flow needs verification.",
    acceptanceCriteria: "Tests cover happy and failure paths",
    definitionOfDone: "Admin sees passing tester notes.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "high",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  app.claimCard(card.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: ship reset tests. Claimed fix: implementation is ready for review.",
  });
  app.moveCard(card.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "testing",
    humanSummary: "Goal: ship reset tests. Review result: ready for tester verification.",
  });

  assert.throws(
    () => app.moveCard(card.id, { actor: "test-agent", role: "tester", status: "done" }),
    /cannot move/,
  );

  const done = app.completeCard(card.id, { actor: "aditya", role: "admin" });
  assert.equal(done.status, "done");

  app.close();
});

test("context layers add project and card scoped memory", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Explain reset implementation",
    problemStatement: "Reviewers need implementation context.",
    acceptanceCriteria: "Implementation notes mention changed files",
    definitionOfDone: "Reviewer can read context without the full timeline.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  const featureBrief = app.addContextLayer({
    feature: "Login Revamp",
    type: "feature_brief",
    title: "Login feature brief",
    body: "Password reset belongs to the login recovery journey.",
    actor: "pm-agent",
    role: "pm",
  });
  const projectMap = app.addContextLayer({
    project: "Mobile App",
    type: "project_map",
    title: "Mobile app map",
    body: "## Structure\\n- src/auth handles reset flows",
    actor: "mapper-agent",
    role: "developer",
  });
  const implementation = app.addContextLayer({
    card: card.id,
    type: "implementation_notes",
    title: "Reset implementation notes",
    body: "## Work\\n- Updated reset token validation\\n- @review-agent start with src/auth/reset.js",
    actor: "dev-agent",
    role: "developer",
  });

  assert.equal(featureBrief.scope, "feature");
  assert.equal(featureBrief.layerType, "feature_brief");
  assert.equal(projectMap.scope, "project");
  assert.equal(projectMap.layerType, "project_map");
  assert.equal(projectMap.bodyMarkdown, "## Structure\n- src/auth handles reset flows");
  assert.equal(implementation.scope, "card");
  assert.equal(implementation.cardId, card.id);

  assert.deepEqual(
    app.listContextLayers({ feature: "Login Revamp" }).map((layer) => layer.id),
    [featureBrief.id],
  );
  assert.deepEqual(
    app.listContextLayers({ project: "Mobile App" }).map((layer) => layer.id),
    [projectMap.id],
  );
  assert.deepEqual(
    app.listContextLayers({ card: card.id, type: "implementation_notes" }).map((layer) => layer.id),
    [implementation.id],
  );

  const contextEvent = app.getCard(card.id).events.find((event) => event.action === "context.added");
  assert.equal(contextEvent.metadata.layerId, implementation.id);
  assert.equal(contextEvent.metadata.layerType, "implementation_notes");

  const inbox = app.listAgentNotifications({ agent: "review-agent", unread: true });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].event.action, "context.added");

  app.close();
});

test("context layer validation rejects bad scopes, types, and oversized bodies", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Validate context inputs",
    problemStatement: "Context layers need strict boundaries.",
    acceptanceCriteria: "Invalid context is rejected loudly",
    definitionOfDone: "Bad writes do not create layers.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });

  assert.throws(
    () =>
      app.addContextLayer({
        project: "Mobile App",
        feature: "Login Revamp",
        type: "feature_brief",
        title: "Bad scope",
        body: "Cannot be both feature and project scoped.",
      }),
    /exactly one of project, feature, or card/,
  );
  assert.throws(
    () =>
      app.addContextLayer({
        project: "Mobile App",
        card: card.id,
        type: "project_map",
        title: "Bad scope",
        body: "Cannot be both project and card scoped.",
      }),
    /exactly one of project, feature, or card/,
  );
  assert.throws(
    () =>
      app.addContextLayer({
        project: "Mobile App",
        type: "unknown",
        title: "Unknown type",
        body: "No such type.",
      }),
    /Layer type must be one of/,
  );
  assert.throws(
    () =>
      app.addContextLayer({
        project: "Mobile App",
        type: "implementation_notes",
        title: "Wrong scope",
        body: "Implementation notes belong to cards.",
      }),
    /implementation_notes can only be scoped to: card/,
  );
  assert.throws(
    () =>
      app.addContextLayer({
        card: card.id,
        type: "implementation_notes",
        title: "Too long",
        body: "x".repeat(4001),
      }),
    /implementation_notes body exceeds 4000 chars \(got 4001\)\. Summarize\./,
  );

  app.close();
});

test("context layers supersede immutably and list active layers by default", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Supersede implementation notes",
    problemStatement: "Agents need fresh active notes without losing history.",
    acceptanceCriteria: "Old context is inactive but still readable",
    definitionOfDone: "Latest context is returned by default.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });
  const original = app.addContextLayer({
    card: card.id,
    type: "implementation_notes",
    title: "Initial notes",
    body: "Started with token validation.",
    actor: "dev-agent",
    role: "developer",
  });
  assert.throws(
    () =>
      app.addContextLayer({
        card: card.id,
        type: "implementation_notes",
        title: "Sneaky replacement",
        body: "This should not create lineage without deactivating the old layer.",
        supersedesId: original.id,
        actor: "dev-agent",
        role: "developer",
      }),
    /Use context supersede to replace an existing context layer/,
  );

  const replacement = app.supersedeContextLayer(original.id, {
    title: "Final notes",
    body: "Finished token validation and added edge case tests.",
    actor: "dev-agent",
    role: "developer",
  });
  const inactive = app.getContextLayer(original.id);
  const active = app.listContextLayers({ card: card.id, type: "implementation_notes" });
  const all = app.listContextLayers({
    card: card.id,
    type: "implementation_notes",
    includeSuperseded: true,
  });

  assert.equal(replacement.supersedesId, original.id);
  assert.equal(inactive.supersededById, replacement.id);
  assert.deepEqual(active.map((layer) => layer.id), [replacement.id]);
  assert.deepEqual(
    all.map((layer) => layer.id),
    [replacement.id, original.id],
  );
  assert.throws(
    () =>
      app.supersedeContextLayer(original.id, {
        body: "Trying to supersede inactive context.",
        actor: "dev-agent",
        role: "developer",
      }),
    new RegExp(`Layer ${original.id} already superseded by ${replacement.id}`),
  );

  const events = app.getCard(card.id).events.filter((event) => event.action.startsWith("context."));
  assert.deepEqual(
    events.map((event) => event.action),
    ["context.added", "context.superseded"],
  );
  assert.equal(events[1].metadata.layerId, replacement.id);
  assert.equal(events[1].metadata.supersedesId, original.id);

  app.close();
});

test("brief returns bounded card context with latest active layers", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Review reset handoff",
    problemStatement: "Reviewer needs a bounded work brief.",
    acceptanceCriteria: "Brief includes active implementation notes",
    definitionOfDone: "Reviewer can start without reading the full timeline.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });
  app.addContextLayer({
    feature: "Login Revamp",
    type: "feature_brief",
    title: "Login feature brief",
    body: "Reset work must preserve the existing login recovery journey.",
    actor: "pm-agent",
    role: "pm",
  });
  app.addContextLayer({
    project: "Mobile App",
    type: "project_map",
    title: "Mobile app project map",
    body: "Auth flows live in src/auth. Run npm test for validation.",
    actor: "mapper-agent",
    role: "developer",
  });
  const originalNotes = app.addContextLayer({
    card: card.id,
    type: "implementation_notes",
    title: "Initial implementation notes",
    body: "Started token validation.",
    actor: "dev-agent",
    role: "developer",
  });
  const activeNotes = app.supersedeContextLayer(originalNotes.id, {
    title: "Final implementation notes",
    body: "Finished token validation and added invalid-token tests.",
    actor: "dev-agent",
    role: "developer",
  });
  const evidence = app.addContextLayer({
    card: card.id,
    type: "validation_evidence",
    title: "Validation evidence",
    body: "npm test passed for reset token paths.",
    actor: "dev-agent",
    role: "developer",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  app.claimCard(card.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  app.addNote(card.id, { actor: "dev-agent", role: "developer", message: "Ready for review." });
  app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: review reset implementation. Claimed fix: token validation is ready for review. Evidence: reset tests pass.",
  });

  const brief = app.briefCard(card.id, { role: "reviewer" });

  assert.equal(Object.hasOwn(brief.card, "events"), false);
  assert.equal(brief.layers.feature_brief.layerType, "feature_brief");
  assert.equal(brief.layers.project_map.layerType, "project_map");
  assert.equal(brief.layers.implementation_notes.id, activeNotes.id);
  assert.equal(brief.layers.validation_evidence.id, evidence.id);
  assert.equal(brief.layers.human_review_summary.layerType, "human_review_summary");
  assert.equal(brief.decisions.length, 1);
  assert.equal(brief.decisions[0].action, "admin.approved");
  assert.equal(brief.recentEvents.length, 5);
  assert.match(brief.nextAction, /Check implementation_notes/);

  app.close();
});

test("context gaps return projects and cards missing active context", () => {
  const app = seededApp();
  app.createFeature({ name: "API", actor: "pm-agent", role: "pm" });
  app.createProject({ feature: "API", name: "Backend", actor: "admin", role: "admin" });
  app.addContextLayer({
    feature: "Login Revamp",
    type: "feature_brief",
    title: "Login feature brief",
    body: "Login recovery work spans the mobile app.",
    actor: "pm-agent",
    role: "pm",
  });
  app.addContextLayer({
    project: "Mobile App",
    type: "project_map",
    title: "Mobile map",
    body: "Mobile entry points live under app/.",
    actor: "mapper-agent",
    role: "developer",
  });

  const reviewMissing = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Review missing notes",
    problemStatement: "Review needs implementation notes.",
    acceptanceCriteria: "Review card is listed as missing notes",
    definitionOfDone: "Context gaps include this review card.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });
  const reviewCovered = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Review covered notes",
    problemStatement: "Review has implementation notes.",
    acceptanceCriteria: "Review card is not listed as missing notes",
    definitionOfDone: "Context gaps exclude this review card.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm-agent",
    role: "pm",
  });
  const testingMissing = app.createCard({
    project: "Backend",
    feature: "API",
    title: "Testing missing evidence",
    problemStatement: "Testing needs validation evidence.",
    acceptanceCriteria: "Testing card is listed as missing evidence",
    definitionOfDone: "Context gaps include this testing card.",
    targetRepo: "git@example.com:backend/api.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });
  const testingCovered = app.createCard({
    project: "Backend",
    feature: "API",
    title: "Testing covered evidence",
    problemStatement: "Testing has validation evidence.",
    acceptanceCriteria: "Testing card is not listed as missing evidence",
    definitionOfDone: "Context gaps exclude this testing card.",
    targetRepo: "git@example.com:backend/api.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  for (const card of [reviewMissing, reviewCovered, testingMissing, testingCovered]) {
    app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
    app.approveCard(card.id, { actor: "admin", role: "admin" });
    app.claimCard(card.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  }

  app.addContextLayer({
    card: reviewCovered.id,
    type: "implementation_notes",
    title: "Review notes",
    body: "Reviewer should inspect the login controller.",
    actor: "dev-agent",
    role: "developer",
  });
  app.addContextLayer({
    card: testingCovered.id,
    type: "validation_evidence",
    title: "Validation evidence",
    body: "Smoke tests passed locally.",
    actor: "dev-agent",
    role: "developer",
  });

  app.moveCard(reviewMissing.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: verify review gap behavior. Claimed fix: ready for reviewer checks.",
  });
  app.moveCard(reviewCovered.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: verify review coverage. Claimed fix: implementation notes are present.",
  });
  app.moveCard(testingMissing.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: verify testing gap behavior. Claimed fix: ready for review.",
  });
  app.moveCard(testingMissing.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "testing",
    humanSummary: "Goal: verify testing gap behavior. Review result: ready for tester checks.",
  });
  app.moveCard(testingCovered.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: verify testing coverage. Claimed fix: ready for review.",
  });
  app.moveCard(testingCovered.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "testing",
    humanSummary: "Goal: verify testing coverage. Review result: validation evidence is present.",
  });

  const gaps = app.contextGaps();
  assert.deepEqual(gaps.missingFeatureBriefs.map((feature) => feature.name), ["API"]);
  assert.deepEqual(gaps.missingProjectMaps.map((project) => project.name), ["Backend"]);
  assert.deepEqual(gaps.reviewWithoutNotes.map((card) => card.id), [reviewMissing.id]);
  assert.deepEqual(gaps.testingWithoutEvidence.map((card) => card.id), [testingMissing.id]);
  assert.deepEqual(gaps.reviewWithoutHumanSummary, []);
  assert.deepEqual(gaps.testingWithoutHumanSummary, []);
  assert.equal(gaps.reviewWithoutNotes[0].projectName, "Mobile App");
  assert.equal(gaps.testingWithoutEvidence[0].featureName, "API");

  app.close();
});

test("existing project-first databases migrate to feature-first hierarchy", () => {
  const dbPath = tempDb();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      repo_path TEXT NOT NULL DEFAULT '',
      repo_remote TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      UNIQUE (project_id, name)
    );
    CREATE TABLE cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      feature_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      user_story TEXT NOT NULL DEFAULT '',
      problem_statement TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      definition_of_done TEXT NOT NULL,
      target_repo TEXT NOT NULL,
      expected_role TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      story_points INTEGER NOT NULL DEFAULT 0,
      sprint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      approval_status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      assigned_role TEXT NOT NULL DEFAULT '',
      assigned_agent TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      commit_sha TEXT NOT NULL DEFAULT '',
      pr_url TEXT NOT NULL DEFAULT '',
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO projects (id, name, description, repo_path, repo_remote, created_at)
    VALUES (1, 'Mobile App', 'iOS and Android client', '/repo/mobile', 'git@example.com:mobile/app.git', '2026-06-10T00:00:00.000Z');
    INSERT INTO features (id, project_id, name, summary, status, created_at)
    VALUES (1, 1, 'Login Revamp', 'Improve login', 'active', '2026-06-10T00:01:00.000Z');
    INSERT INTO cards (
      id, project_id, feature_id, title, user_story, problem_statement, acceptance_criteria,
      definition_of_done, target_repo, expected_role, risk_level, story_points, sprint, status,
      approval_status, priority, assigned_role, assigned_agent, branch, commit_sha, pr_url,
      created_by_role, created_at, updated_at
    )
    VALUES (
      1, 1, 1, 'Migrate this card', '', 'Old DB card should survive.', '["Card is readable"]',
      'Card is still listed.', 'git@example.com:mobile/app.git', 'developer', 'medium', 3,
      'Sprint 1', 'draft', 'draft', 3, '', '', '', '', '', 'pm',
      '2026-06-10T00:02:00.000Z', '2026-06-10T00:02:00.000Z'
    );
  `);
  db.close();

  const app = createRelay({ dbPath, cwd: process.cwd() });
  const [card] = app.listCards();

  assert.equal(card.title, "Migrate this card");
  assert.equal(card.featureName, "Login Revamp");
  assert.equal(card.projectName, "Mobile App");
  assert.equal(app.listFeatures()[0].name, "Login Revamp");
  assert.equal(app.listProjects({ feature: "Login Revamp" })[0].name, "Mobile App");

  app.close();
});

test("claim returns a brief and move manages handoff context with soft warnings", () => {
  const app = seededApp();
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Review reset lifecycle context",
    problemStatement: "Lifecycle handoffs need context by default.",
    acceptanceCriteria: "Claim returns brief and move can write handoff intent",
    definitionOfDone: "Warnings guide agents without blocking moves.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  app.approveCard(card.id, { actor: "aditya", role: "admin" });
  const claimed = app.claimCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    agent: "dev-agent",
  });

  assert.equal(claimed.status, "in_progress");
  assert.equal(claimed.brief.card.id, card.id);
  assert.equal(claimed.brief.card.status, "in_progress");

  assert.throws(
    () =>
      app.moveCard(card.id, {
        actor: "dev-agent",
        role: "developer",
        status: "review",
        handoff: "Reviewer should start with reset token expiry.",
      }),
    /requires a human review summary/,
  );

  const missingNotesMove = app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    handoff: "Reviewer should start with reset token expiry.",
    humanSummary: "Goal: make reset lifecycle reviewable. Claimed fix: reset token expiry is implemented. Evidence: targeted tests pass.",
  });
  const firstHandoff = app.listContextLayers({ card: card.id, type: "handoff_intent" })[0];
  const firstHumanSummary = app.listContextLayers({ card: card.id, type: "human_review_summary" })[0];

  assert.deepEqual(missingNotesMove.warnings, [
    `Card #${card.id} has no implementation_notes; the reviewer will lack context.`,
  ]);
  assert.equal(firstHandoff.bodyMarkdown, "Reviewer should start with reset token expiry.");
  assert.match(firstHumanSummary.bodyMarkdown, /reset lifecycle/);

  app.moveCard(card.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "in_progress",
    handoff: "Developer should add the invalid-token test.",
  });
  const handoffs = app.listContextLayers({
    card: card.id,
    type: "handoff_intent",
    includeSuperseded: true,
  });
  assert.equal(handoffs[0].supersedesId, firstHandoff.id);
  assert.equal(handoffs[1].supersededById, handoffs[0].id);

  app.addContextLayer({
    card: card.id,
    type: "implementation_notes",
    title: "Implementation notes",
    body: "Added reset token expiry handling.",
    actor: "dev-agent",
    role: "developer",
  });
  const cleanReviewMove = app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    humanSummary: "Goal: make reset lifecycle reviewable. Claimed fix: invalid-token tests were added. Evidence: targeted tests pass.",
  });
  assert.deepEqual(cleanReviewMove.warnings, []);
  const humanSummaries = app.listContextLayers({
    card: card.id,
    type: "human_review_summary",
    includeSuperseded: true,
  });
  assert.equal(humanSummaries[0].supersedesId, firstHumanSummary.id);

  assert.throws(
    () =>
      app.moveCard(card.id, {
        actor: "review-agent",
        role: "reviewer",
        status: "testing",
      }),
    /requires a human review summary/,
  );

  const missingEvidenceMove = app.moveCard(card.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "testing",
    humanSummary: "Goal: make reset lifecycle testable. Review result: ready for QA; evidence layer is still missing.",
  });
  assert.deepEqual(missingEvidenceMove.warnings, [
    `Card #${card.id} has no validation_evidence; the tester will lack context.`,
  ]);

  app.close();
});

test("card lint warns without blocking submission", () => {
  const app = seededApp();
  const title = "Add exhaustive account recovery throttling and device anomaly checks now";
  const problem = "Current recovery has too many risk paths. ".repeat(20);
  const criteria = [
    "Failed recovery attempts are rate limited",
    "Successful recovery remains unaffected",
    "Rate limit resets after 60 seconds",
    "Device anomaly creates an audit event",
    "Admins can see the audit event",
    "Integration tests cover rate limit",
    "Integration tests cover reset",
    "Integration tests cover happy path",
  ];
  const card = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title,
    problemStatement: problem,
    acceptanceCriteria: criteria,
    definitionOfDone: "Tests pass and validation_evidence is written.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    storyPoints: 8,
    actor: "pm-agent",
    role: "pm",
  });

  assert.deepEqual(app.lintCard(card.id), [
    "Titles over 60 chars get approved slower. Use an imperative outcome-focused title under 60 chars.",
    "Long problem statements get approved slower. State what is true today and why it's a problem in 2-4 sentences.",
    "More than 7 acceptance criteria usually means this is two cards. Consider splitting.",
    "Cards should be completable in one agent session. Consider splitting.",
  ]);

  const submitted = app.submitCard(card.id, { actor: "pm-agent", role: "pm" });
  assert.equal(submitted.status, "pending_approval");
  assert.equal(submitted.warnings.length, 4);

  const clean = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Add reset rate limit",
    problemStatement: "Reset attempts are unlimited. A script can brute force reset codes.",
    acceptanceCriteria: [
      "More than 5 failed attempts per minute returns 429",
      "Successful reset remains unaffected",
      "Integration test covers the limit and happy path",
    ],
    definitionOfDone: "Tests pass and validation_evidence is written.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    storyPoints: 3,
    actor: "pm-agent",
    role: "pm",
  });
  assert.deepEqual(app.lintCard(clean.id), []);

  app.close();
});

test("recent send-backs are returned for PM card creation and needs-changes briefs", () => {
  const app = seededApp();
  const first = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Clarify reset scope",
    problemStatement: "Reset scope is unclear.",
    acceptanceCriteria: "Tester can verify the reset scope",
    definitionOfDone: "Admin can approve the revised card.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  app.submitCard(first.id, { actor: "pm-agent", role: "pm" });
  app.requestChanges(first.id, {
    actor: "aditya",
    role: "admin",
    reason: "Too big — split it",
  });

  const next = app.createCard({
    project: "Mobile App",
    feature: "Login Revamp",
    title: "Add reset token expiry",
    problemStatement: "Reset tokens never expire.",
    acceptanceCriteria: "Expired reset tokens are rejected",
    definitionOfDone: "Tests pass and validation_evidence is written.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });
  const brief = app.briefCard(first.id, { role: "pm" });

  assert.deepEqual(next.recentSendBacks, ["Too big — split it"]);
  assert.deepEqual(brief.recentSendBacks, ["Too big — split it"]);

  app.close();
});
