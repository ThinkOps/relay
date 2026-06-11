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
  app.createProject({ name: "Relay", actor: "admin", role: "admin" });
  app.createFeature({ project: "Relay", name: "Admin Gate", actor: "pm", role: "pm" });
  app.createFeature({ project: "Relay", name: "Board Views", actor: "pm", role: "pm" });
  app.createProject({ name: "Mobile App", actor: "admin", role: "admin" });
  app.createFeature({ project: "Mobile App", name: "Login", actor: "pm", role: "pm" });
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
    storyPoints: 3,
    sprint: "Sprint 2",
    actor: "pm",
    role: "pm",
  });
  app.createCard({
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
  app.heartbeat({ agent: "dev-agent", role: "developer" });
  app.close();

  const server = await startServer({ dbPath, cwd: process.cwd(), port: 0 });
  try {
    const boardResponse = await fetch(`${server.url}/api/board`);
    const board = await boardResponse.json();
    assert.equal(board.pending_approval.length, 1);
    assert.equal(board.pending_approval[0].storyPoints, 3);
    assert.equal(board.pending_approval[0].sprint, "Sprint 2");
    assert.equal(board.pending_approval[0].events.at(-1).action, "card.submitted");

    const navigationResponse = await fetch(`${server.url}/api/navigation`);
    const navigation = await navigationResponse.json();
    const relay = navigation.projects.find((project) => project.name === "Relay");
    const adminGate = relay.features.find((feature) => feature.name === "Admin Gate");
    assert.equal(navigation.counts.total, 3);
    assert.equal(navigation.onlineAgents.length, 1);
    assert.equal(navigation.onlineAgents[0].agent, "dev-agent");
    assert.equal(navigation.inboxCounts.action, 1);
    assert.equal(relay.counts.total, 2);
    assert.equal(adminGate.counts.pending, 1);

    const inboxResponse = await fetch(`${server.url}/api/inbox`);
    const inbox = await inboxResponse.json();
    assert.equal(inbox.actionItems.length, 1);
    assert.equal(inbox.actionItems[0].cardId, card.id);
    assert.equal(inbox.actionItems[0].label, "Needs approval");
    assert.equal(inbox.counts.action, 1);
    assert.equal(inbox.updateItems[0].label, "Update");
    assert.match(inbox.updateItems[0].message, /Progress/);

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
  } finally {
    await server.close();
  }
});
