const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createMistri } = require("../src/domain");
const { startServer } = require("../src/server");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mistri-server-test-"));
  return path.join(dir, "mistri.db");
}

test("server exposes board data and protects mutations with token", async () => {
  const dbPath = tempDb();
  const app = createMistri({ dbPath, cwd: process.cwd() });
  app.createProject({ name: "Mistri", actor: "admin", role: "admin" });
  app.createFeature({ project: "Mistri", name: "Admin Gate", actor: "pm", role: "pm" });
  app.createFeature({ project: "Mistri", name: "Board Views", actor: "pm", role: "pm" });
  app.createProject({ name: "Mobile App", actor: "admin", role: "admin" });
  app.createFeature({ project: "Mobile App", name: "Login", actor: "pm", role: "pm" });
  const card = app.createCard({
    project: "Mistri",
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
    acceptanceCriteria: "Mistri board excludes mobile cards",
    definitionOfDone: "Project filter returns only matching project cards.",
    targetRepo: "local",
    expectedRole: "developer",
    riskLevel: "low",
    actor: "pm",
    role: "pm",
  });
  app.submitCard(card.id, { actor: "pm", role: "pm" });
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
    const mistri = navigation.projects.find((project) => project.name === "Mistri");
    const adminGate = mistri.features.find((feature) => feature.name === "Admin Gate");
    assert.equal(navigation.counts.total, 2);
    assert.equal(navigation.onlineAgents.length, 1);
    assert.equal(navigation.onlineAgents[0].agent, "dev-agent");
    assert.equal(mistri.counts.total, 1);
    assert.equal(adminGate.counts.pending, 1);

    const projectBoardResponse = await fetch(`${server.url}/api/board?project=${mistri.id}`);
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
        "X-Mistri-Token": server.token,
      },
    });
    const body = await approved.json();
    assert.equal(approved.status, 200);
    assert.equal(body.status, "ready");
  } finally {
    await server.close();
  }
});
