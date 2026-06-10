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
  app.submitCard(card.id, { actor: "pm", role: "pm" });
  app.close();

  const server = await startServer({ dbPath, cwd: process.cwd(), port: 0 });
  try {
    const boardResponse = await fetch(`${server.url}/api/board`);
    const board = await boardResponse.json();
    assert.equal(board.pending_approval.length, 1);
    assert.equal(board.pending_approval[0].storyPoints, 3);
    assert.equal(board.pending_approval[0].sprint, "Sprint 2");

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
