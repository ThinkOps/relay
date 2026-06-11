const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { defaultDbPath, requireWorkspace, workspaceForInit } = require("../src/paths");

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

test("workspace init defaults to the local user data database", () => {
  const root = tempDir();
  const dataHome = path.join(root, "data-home");
  const workspace = workspaceForInit(path.join(root, "agent-repo"), "", { RELAY_DATA_HOME: dataHome });

  assert.equal(workspace.dbPath, path.join(dataHome, "relay.db"));
  assert.equal(workspace.relayDir, dataHome);
  assert.equal(defaultDbPath({ RELAY_DATA_HOME: dataHome }), path.join(dataHome, "relay.db"));
});

test("normal commands discover the local user data database", () => {
  const root = tempDir();
  const dataHome = path.join(root, "data-home");
  const dbPath = path.join(dataHome, "relay.db");
  fs.mkdirSync(dataHome, { recursive: true });
  fs.writeFileSync(dbPath, "");

  const workspace = requireWorkspace(path.join(root, "agent-repo"), "", { RELAY_DATA_HOME: dataHome });
  assert.equal(workspace.dbPath, dbPath);
});

test("local user data database wins over existing workspaces", () => {
  const root = tempDir();
  const localDb = path.join(root, "agent-repo", ".relay", "relay.db");
  const dataHome = path.join(root, "data-home");
  const fallbackDb = path.join(dataHome, "relay.db");
  fs.mkdirSync(path.dirname(localDb), { recursive: true });
  fs.mkdirSync(dataHome, { recursive: true });
  fs.writeFileSync(localDb, "");
  fs.writeFileSync(fallbackDb, "");

  const workspace = requireWorkspace(path.dirname(localDb), "", { RELAY_DATA_HOME: dataHome });
  assert.equal(workspace.dbPath, fallbackDb);
});

test("existing workspace is discovered when local user data database is absent", () => {
  const root = tempDir();
  const localDb = path.join(root, "agent-repo", ".relay", "relay.db");
  const dataHome = path.join(root, "data-home");
  fs.mkdirSync(path.dirname(localDb), { recursive: true });
  fs.writeFileSync(localDb, "");

  const workspace = requireWorkspace(path.dirname(localDb), "", { RELAY_DATA_HOME: dataHome });
  assert.equal(workspace.dbPath, localDb);
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

test("missing workspace suggests the local user data database", () => {
  const root = tempDir();
  const dataHome = path.join(root, "data-home");

  assert.throws(
    () => requireWorkspace(path.join(root, "agent-repo"), "", { RELAY_DATA_HOME: dataHome }),
    new RegExp(`No Relay database found. Run \`relay init\` to create ${path.join(dataHome, "relay.db")}`),
  );
});
