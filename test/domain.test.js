const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRelay } = require("../src/domain");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-test-"));
  return path.join(dir, "relay.db");
}

function seededApp() {
  const app = createRelay({ dbPath: tempDb(), cwd: process.cwd() });
  app.createProject({ name: "Mobile App", actor: "admin", role: "admin" });
  app.createFeature({
    project: "Mobile App",
    name: "Login Revamp",
    summary: "Improve login flows",
    actor: "pm-agent",
    role: "pm",
  });
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
  app.moveCard(card.id, { actor: "dev-agent", role: "developer", status: "review" });
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
  app.moveCard(card.id, { actor: "dev-agent", role: "developer", status: "review" });
  app.moveCard(card.id, { actor: "review-agent", role: "reviewer", status: "testing" });

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

  assert.equal(projectMap.scope, "project");
  assert.equal(projectMap.layerType, "project_map");
  assert.equal(projectMap.bodyMarkdown, "## Structure\n- src/auth handles reset flows");
  assert.equal(implementation.scope, "card");
  assert.equal(implementation.cardId, card.id);

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
  app.moveCard(card.id, { actor: "dev-agent", role: "developer", status: "review" });

  const brief = app.briefCard(card.id, { role: "reviewer" });

  assert.equal(Object.hasOwn(brief.card, "events"), false);
  assert.equal(brief.layers.project_map.layerType, "project_map");
  assert.equal(brief.layers.implementation_notes.id, activeNotes.id);
  assert.equal(brief.layers.validation_evidence.id, evidence.id);
  assert.equal(brief.decisions.length, 1);
  assert.equal(brief.decisions[0].action, "admin.approved");
  assert.equal(brief.recentEvents.length, 5);
  assert.match(brief.nextAction, /Check implementation_notes/);

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

  const missingNotesMove = app.moveCard(card.id, {
    actor: "dev-agent",
    role: "developer",
    status: "review",
    handoff: "Reviewer should start with reset token expiry.",
  });
  const firstHandoff = app.listContextLayers({ card: card.id, type: "handoff_intent" })[0];

  assert.deepEqual(missingNotesMove.warnings, [
    `Card #${card.id} has no implementation_notes; the reviewer will lack context.`,
  ]);
  assert.equal(firstHandoff.bodyMarkdown, "Reviewer should start with reset token expiry.");

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
  });
  assert.deepEqual(cleanReviewMove.warnings, []);

  const missingEvidenceMove = app.moveCard(card.id, {
    actor: "review-agent",
    role: "reviewer",
    status: "testing",
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
