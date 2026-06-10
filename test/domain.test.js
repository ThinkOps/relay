const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createMistri } = require("../src/domain");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mistri-test-"));
  return path.join(dir, "mistri.db");
}

function seededApp() {
  const app = createMistri({ dbPath: tempDb(), cwd: process.cwd() });
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
    problemStatement: "Users need to recover accounts without support.",
    acceptanceCriteria: ["User can request reset email", "Expired tokens are rejected"],
    definitionOfDone: "Reset flow works and is tested.",
    targetRepo: "git@example.com:mobile/app.git",
    expectedRole: "developer",
    riskLevel: "medium",
    actor: "pm-agent",
    role: "pm",
  });

  assert.equal(card.status, "draft");
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

