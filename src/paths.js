const fs = require("node:fs");
const path = require("node:path");

const MISTRI_DIR = ".mistri";
const DB_FILE = "mistri.db";

function workspaceFromDbPath(dbPath) {
  const resolved = path.resolve(dbPath);
  return {
    root: path.dirname(path.dirname(resolved)),
    mistriDir: path.dirname(resolved),
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
    const dbPath = path.join(current, MISTRI_DIR, DB_FILE);
    if (fs.existsSync(dbPath)) {
      return {
        root: current,
        mistriDir: path.join(current, MISTRI_DIR),
        dbPath,
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
    mistriDir: path.join(root, MISTRI_DIR),
    dbPath: path.join(root, MISTRI_DIR, DB_FILE),
  };
}

function requireWorkspace(cwd = process.cwd(), dbPath) {
  const workspace = findWorkspace(cwd, dbPath);
  if (!workspace) {
    if (dbPath) {
      throw new Error(`Mistri database not found at ${path.resolve(dbPath)}. Run \`mistri init --db ${path.resolve(dbPath)}\` first.`);
    }
    throw new Error("No Mistri workspace found. Run `mistri init` first.");
  }
  return workspace;
}

module.exports = {
  MISTRI_DIR,
  DB_FILE,
  findWorkspace,
  requireWorkspace,
  workspaceFromDbPath,
  workspaceForInit,
};
