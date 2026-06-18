const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRelay } = require("../src/domain");
const { startServer } = require("../src/server");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relay-server-test-"));
  return path.join(dir, "relay.db");
}

test("server exposes board data and protects mutations with token", async () => {
  const dbPath = tempDb();
  const app = createRelay({ dbPath, cwd: process.cwd() });
  app.createFeature({ name: "Admin Gate", actor: "pm", role: "pm" });
  app.createProject({ feature: "Admin Gate", name: "Relay", actor: "admin", role: "admin" });
  app.createFeature({ name: "Board Views", actor: "pm", role: "pm" });
  app.createProject({ feature: "Board Views", name: "Relay", actor: "admin", role: "admin" });
  app.createFeature({ name: "Login", actor: "pm", role: "pm" });
  app.createProject({ feature: "Login", name: "Mobile App", actor: "admin", role: "admin" });
  const card = app.createCard({
    project: "Relay",
    feature: "Admin Gate",
    title: "Approve scoped work",
    problemStatement: "Admin needs to control agent execution.",
    acceptanceCriteria: "Card waits for approval",
    definitionOfDone: "API approval moves card to ready.",
    targetRepo: "local",
    expectedRole: "developer",
    riskLevel: "low",
    storyPoints: 8,
    sprint: "Sprint 2",
    actor: "pm",
    role: "pm",
  });
  const mobileCard = app.createCard({
    project: "Mobile App",
    feature: "Login",
    title: "Keep mobile work separate",
    problemStatement: "Project filters should not leak unrelated cards.",
    acceptanceCriteria: "Relay board excludes mobile cards",
    definitionOfDone: "Project filter returns only matching project cards.",
    targetRepo: "local",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm",
    role: "pm",
  });
  const claimedCard = app.createCard({
    project: "Relay",
    feature: "Board Views",
    title: "Show agent presence",
    problemStatement: "Admin needs to see which agent is working.",
    acceptanceCriteria: "Agent view lists active assigned work",
    definitionOfDone: "UI can show the assigned online agent.",
    targetRepo: "local",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm",
    role: "pm",
  });
  app.submitCard(card.id, { actor: "pm", role: "pm" });
  app.submitCard(claimedCard.id, { actor: "pm", role: "pm" });
  app.approveCard(claimedCard.id, { actor: "admin", role: "admin" });
  app.claimCard(claimedCard.id, { actor: "dev-agent", role: "developer", agent: "dev-agent" });
  app.addNote(claimedCard.id, {
    actor: "dev-agent",
    role: "developer",
    message: "## Progress\\n- Presence chip is wired",
  });
  app.addContextLayer({
    feature: "Admin Gate",
    type: "feature_brief",
    title: "Admin gate brief",
    body: "Admin approval protects every card before execution.",
    actor: "pm",
    role: "pm",
  });
  app.addContextLayer({
    feature: "Board Views",
    type: "feature_brief",
    title: "Board views brief",
    body: "Board views make active work and agent state visible.",
    actor: "pm",
    role: "pm",
  });
  app.addContextLayer({
    feature: "Login",
    type: "feature_brief",
    title: "Login brief",
    body: "Mobile login work is separate from Relay admin work.",
    actor: "pm",
    role: "pm",
  });
  app.addContextLayer({
    project: "Admin Gate:Relay",
    type: "project_map",
    title: "Relay admin gate map",
    body: "Relay approval code lives in src/domain.js.",
    actor: "mapper-agent",
    role: "developer",
  });
  app.addContextLayer({
    project: "Board Views:Relay",
    type: "project_map",
    title: "Relay board views map",
    body: "Relay server code lives in src/server.js.",
    actor: "mapper-agent",
    role: "developer",
  });
  app.addContextLayer({
    card: claimedCard.id,
    type: "implementation_notes",
    title: "Presence implementation",
    body: "Updated agent presence rendering.",
    actor: "dev-agent",
    role: "developer",
  });
  app.heartbeat({ agent: "dev-agent", role: "developer" });
  app.close();

  const server = await startServer({ dbPath, cwd: process.cwd(), port: 0 });
  try {
    const boardResponse = await fetch(`${server.url}/api/board`);
    const board = await boardResponse.json();
    assert.equal(board.pending_approval.length, 1);
    assert.equal(board.pending_approval[0].storyPoints, 8);
    assert.equal(board.pending_approval[0].sprint, "Sprint 2");
    assert.equal(board.pending_approval[0].events.at(-1).action, "card.submitted");
    assert.deepEqual(board.pending_approval[0].lintWarnings, [
      "Cards should be completable in one agent session. Consider splitting.",
    ]);

    const navigationResponse = await fetch(`${server.url}/api/navigation`);
    const navigation = await navigationResponse.json();
    const adminGate = navigation.features.find((feature) => feature.name === "Admin Gate");
    const relay = adminGate.projects.find((project) => project.name === "Relay");
    assert.equal(navigation.counts.total, 3);
    assert.equal(navigation.onlineAgents.length, 1);
    assert.equal(navigation.onlineAgents[0].agent, "dev-agent");
    assert.equal(navigation.inboxCounts.action, 1);
    assert.equal(relay.counts.total, 1);
    assert.equal(adminGate.counts.pending, 1);

    const inboxResponse = await fetch(`${server.url}/api/inbox`);
    const inbox = await inboxResponse.json();
    assert.equal(inbox.actionItems.length, 1);
    assert.equal(inbox.actionItems[0].cardId, card.id);
    assert.equal(inbox.actionItems[0].label, "Needs approval");
    assert.deepEqual(inbox.actionItems[0].lintWarnings, [
      "Cards should be completable in one agent session. Consider splitting.",
    ]);
    assert.equal(inbox.counts.action, 1);
    assert.equal(inbox.counts.gaps, 1);
    assert.equal(inbox.contextGaps.missingProjectMaps[0].name, "Mobile App");
    assert.equal(inbox.updateItems[0].label, "Update");
    assert.match(inbox.updateItems[0].message, /Progress/);

    const briefResponse = await fetch(`${server.url}/api/cards/${claimedCard.id}/brief?role=reviewer`);
    const brief = await briefResponse.json();
    assert.equal(brief.layers.feature_brief.title, "Board views brief");
    assert.equal(brief.layers.project_map.title, "Relay board views map");
    assert.equal(brief.layers.implementation_notes.title, "Presence implementation");
    assert.equal(Object.hasOwn(brief.card, "events"), false);

    const transitionsResponse = await fetch(`${server.url}/api/cards/${claimedCard.id}/transitions?role=developer`);
    const transitions = await transitionsResponse.json();
    assert.equal(transitionsResponse.status, 200);
    assert.equal(transitions.transitions.find((item) => item.action === "move" && item.toStatus === "review").allowed, true);

    const dependenciesResponse = await fetch(`${server.url}/api/cards/${claimedCard.id}/dependencies`);
    const dependencies = await dependenciesResponse.json();
    assert.equal(dependenciesResponse.status, 200);
    assert.deepEqual(dependencies.blockedBy, []);

    const contextResponse = await fetch(`${server.url}/api/cards/${claimedCard.id}/context`);
    const context = await contextResponse.json();
    assert.equal(context.length, 1);
    assert.equal(context[0].layerType, "implementation_notes");

    const gapsResponse = await fetch(`${server.url}/api/context/gaps`);
    const gaps = await gapsResponse.json();
    assert.equal(gaps.missingProjectMaps.length, 1);
    assert.equal(gaps.missingProjectMaps[0].name, "Mobile App");

    const agentsResponse = await fetch(`${server.url}/api/agents`);
    const agents = await agentsResponse.json();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agent, "dev-agent");
    assert.equal(agents[0].online, true);
    assert.equal(agents[0].activeCards.length, 1);
    assert.equal(agents[0].activeCards[0].title, "Show agent presence");

    const projectBoardResponse = await fetch(`${server.url}/api/board?project=${relay.id}`);
    const projectBoard = await projectBoardResponse.json();
    assert.equal(projectBoard.pending_approval.length, 1);
    assert.equal(projectBoard.draft.length, 0);

    const featureBoardResponse = await fetch(`${server.url}/api/board?feature=${adminGate.id}`);
    const featureBoard = await featureBoardResponse.json();
    assert.equal(featureBoard.pending_approval[0].featureName, "Admin Gate");

    const approvalsResponse = await fetch(`${server.url}/api/board?view=approvals`);
    const approvals = await approvalsResponse.json();
    assert.equal(approvals.pending_approval.length, 1);
    assert.equal(approvals.draft.length, 0);

    const blocked = await fetch(`${server.url}/api/admin/approve/${card.id}`, {
      method: "POST",
      body: JSON.stringify({ actor: "admin" }),
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(blocked.status, 403);

    const approved = await fetch(`${server.url}/api/admin/approve/${card.id}`, {
      method: "POST",
      body: JSON.stringify({ actor: "admin" }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    const body = await approved.json();
    assert.equal(approved.status, 200);
    assert.equal(body.status, "ready");

    const submittedForChanges = await fetch(`${server.url}/api/cards/${mobileCard.id}/submit`, {
      method: "POST",
      body: JSON.stringify({ actor: "pm" }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    assert.equal(submittedForChanges.status, 200);

    const cannedChange = await fetch(`${server.url}/api/admin/changes/${mobileCard.id}`, {
      method: "POST",
      body: JSON.stringify({ actor: "admin", reason: "Missing context" }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    const changedCard = await cannedChange.json();
    assert.equal(cannedChange.status, 200);
    assert.equal(changedCard.status, "needs_changes");
    const changedDetail = await fetch(`${server.url}/api/cards/${mobileCard.id}`);
    const changedBody = await changedDetail.json();
    assert.equal(changedBody.events.at(-1).message, "Missing context");

    const createdContextResponse = await fetch(`${server.url}/api/context`, {
      method: "POST",
      body: JSON.stringify({
        actor: "tester",
        body: "Manual QA passed.",
        card: claimedCard.id,
        role: "tester",
        title: "QA evidence",
        type: "validation_evidence",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    const createdContext = await createdContextResponse.json();
    assert.equal(createdContextResponse.status, 200);
    assert.equal(createdContext.layerType, "validation_evidence");

    const invalidLineageResponse = await fetch(`${server.url}/api/context`, {
      method: "POST",
      body: JSON.stringify({
        actor: "tester",
        body: "Manual QA replacement without using supersede.",
        card: claimedCard.id,
        role: "tester",
        supersedesId: createdContext.id,
        title: "Invalid lineage",
        type: "validation_evidence",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    const invalidLineage = await invalidLineageResponse.json();
    assert.equal(invalidLineageResponse.status, 400);
    assert.match(invalidLineage.error, /Use context supersede/);

    const supersededContextResponse = await fetch(`${server.url}/api/context/${createdContext.id}/supersede`, {
      method: "POST",
      body: JSON.stringify({
        actor: "tester",
        body: "Manual QA and smoke tests passed.",
        role: "tester",
      }),
      headers: {
        "Content-Type": "application/json",
        "X-Relay-Token": server.token,
      },
    });
    const supersededContext = await supersededContextResponse.json();
    assert.equal(supersededContextResponse.status, 200);
    assert.equal(supersededContext.supersedesId, createdContext.id);
  } finally {
    await server.close();
  }
});
