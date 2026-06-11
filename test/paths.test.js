const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { requireWorkspace, workspaceForInit } = require("../src/paths");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "relay-paths-test-"));
}

test("workspace init can target a central database path", () => {
  const root = tempDir();
  const dbPath = path.join(root, "control", ".relay", "relay.db");
  const workspace = workspaceForInit(path.join(root, "agent-repo"), dbPath);

  assert.equal(workspace.dbPath, dbPath);
  assert.equal(workspace.relayDir, path.dirname(dbPath));
});

test("central database path must exist for normal commands", () => {
  const root = tempDir();
  const dbPath = path.join(root, "control", ".relay", "missing.db");

  assert.throws(() => requireWorkspace(path.join(root, "agent-repo"), dbPath), /Relay database not found/);
});

test("central database path wins over local workspace discovery", () => {
  const root = tempDir();
  const localDb = path.join(root, "agent-repo", ".relay", "relay.db");
  const centralDb = path.join(root, "control", ".relay", "relay.db");
  fs.mkdirSync(path.dirname(localDb), { recursive: true });
  fs.mkdirSync(path.dirname(centralDb), { recursive: true });
  fs.writeFileSync(localDb, "");
  fs.writeFileSync(centralDb, "");

  const workspace = requireWorkspace(path.dirname(localDb), centralDb);
  assert.equal(workspace.dbPath, centralDb);
});

test("legacy workspace discovery remains supported", () => {
  const root = tempDir();
  const legacyDb = path.join(root, "agent-repo", ".mistri", "mistri.db");
  fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
  fs.writeFileSync(legacyDb, "");

  const workspace = requireWorkspace(path.dirname(legacyDb));
  assert.equal(workspace.dbPath, legacyDb);
  assert.equal(workspace.relayDir, path.dirname(legacyDb));
});
