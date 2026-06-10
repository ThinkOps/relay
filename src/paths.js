const fs = require("node:fs");
const path = require("node:path");

const MISTRI_DIR = ".mistri";
const DB_FILE = "mistri.db";

function findWorkspace(startDir = process.cwd()) {
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

function workspaceForInit(cwd = process.cwd()) {
  const root = path.resolve(cwd);
  return {
    root,
    mistriDir: path.join(root, MISTRI_DIR),
    dbPath: path.join(root, MISTRI_DIR, DB_FILE),
  };
}

function requireWorkspace(cwd = process.cwd()) {
  const workspace = findWorkspace(cwd);
  if (!workspace) {
    throw new Error("No Mistri workspace found. Run `mistri init` first.");
  }
  return workspace;
}

module.exports = {
  MISTRI_DIR,
  DB_FILE,
  findWorkspace,
  requireWorkspace,
  workspaceForInit,
};

