const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { requireWorkspace, workspaceForInit } = require("../src/paths");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mistri-paths-test-"));
}

test("workspace init can target a central database path", () => {
  const root = tempDir();
  const dbPath = path.join(root, "control", ".mistri", "mistri.db");
  const workspace = workspaceForInit(path.join(root, "agent-repo"), dbPath);

  assert.equal(workspace.dbPath, dbPath);
  assert.equal(workspace.mistriDir, path.dirname(dbPath));
});

test("central database path must exist for normal commands", () => {
  const root = tempDir();
  const dbPath = path.join(root, "control", ".mistri", "missing.db");

  assert.throws(() => requireWorkspace(path.join(root, "agent-repo"), dbPath), /Mistri database not found/);
});

test("central database path wins over local workspace discovery", () => {
  const root = tempDir();
  const localDb = path.join(root, "agent-repo", ".mistri", "mistri.db");
  const centralDb = path.join(root, "control", ".mistri", "mistri.db");
  fs.mkdirSync(path.dirname(localDb), { recursive: true });
  fs.mkdirSync(path.dirname(centralDb), { recursive: true });
  fs.writeFileSync(localDb, "");
  fs.writeFileSync(centralDb, "");

  const workspace = requireWorkspace(path.dirname(localDb), centralDb);
  assert.equal(workspace.dbPath, centralDb);
});

