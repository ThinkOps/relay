const fs = require("node:fs");
const path = require("node:path");

const RELAY_DIR = ".relay";
const LEGACY_DIR = ".mistri";
const DB_FILE = "relay.db";
const LEGACY_DB_FILE = "mistri.db";

function workspaceFromDbPath(dbPath) {
  const resolved = path.resolve(dbPath);
  return {
    root: path.dirname(path.dirname(resolved)),
    relayDir: path.dirname(resolved),
    dbPath: resolved,
  };
}

function findWorkspace(startDir = process.cwd(), dbPath) {
  if (dbPath) {
    const workspace = workspaceFromDbPath(dbPath);
    return fs.existsSync(workspace.dbPath) ? workspace : null;
  }

  let current = path.resolve(startDir);

  while (true) {
    const dbPath = path.join(current, RELAY_DIR, DB_FILE);
    if (fs.existsSync(dbPath)) {
      return {
        root: current,
        relayDir: path.join(current, RELAY_DIR),
        dbPath,
      };
    }

    const legacyDbPath = path.join(current, LEGACY_DIR, LEGACY_DB_FILE);
    if (fs.existsSync(legacyDbPath)) {
      return {
        root: current,
        relayDir: path.join(current, LEGACY_DIR),
        dbPath: legacyDbPath,
      };
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function workspaceForInit(cwd = process.cwd(), dbPath) {
  if (dbPath) return workspaceFromDbPath(dbPath);

  const root = path.resolve(cwd);
  return {
    root,
    relayDir: path.join(root, RELAY_DIR),
    dbPath: path.join(root, RELAY_DIR, DB_FILE),
  };
}

function requireWorkspace(cwd = process.cwd(), dbPath) {
  const workspace = findWorkspace(cwd, dbPath);
  if (!workspace) {
    if (dbPath) {
      throw new Error(`Relay database not found at ${path.resolve(dbPath)}. Run \`relay init --db ${path.resolve(dbPath)}\` first.`);
    }
    throw new Error("No Relay workspace found. Run `relay init` first.");
  }
  return workspace;
}

module.exports = {
  RELAY_DIR,
  DB_FILE,
  LEGACY_DIR,
  LEGACY_DB_FILE,
  findWorkspace,
  requireWorkspace,
  workspaceFromDbPath,
  workspaceForInit,
};
