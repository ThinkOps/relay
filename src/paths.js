const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const RELAY_DIR = ".relay";
const DB_FILE = "relay.db";
const APP_DIR = "relay";

function workspaceFromDbPath(dbPath) {
  const resolved = path.resolve(dbPath);
  return {
    root: path.dirname(path.dirname(resolved)),
    relayDir: path.dirname(resolved),
    dbPath: resolved,
  };
}

function defaultDbPath(env = process.env) {
  if (env.RELAY_DATA_HOME) return path.join(path.resolve(env.RELAY_DATA_HOME), DB_FILE);

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", APP_DIR, DB_FILE);
  }

  if (process.platform === "win32") {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), APP_DIR, DB_FILE);
  }

  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_DIR, DB_FILE);
}

function findWorkspace(startDir = process.cwd(), dbPath, env = process.env) {
  if (dbPath) {
    const workspace = workspaceFromDbPath(dbPath);
    return fs.existsSync(workspace.dbPath) ? workspace : null;
  }

  const fallback = workspaceFromDbPath(defaultDbPath(env));
  if (fs.existsSync(fallback.dbPath)) return fallback;

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

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function workspaceForInit(cwd = process.cwd(), dbPath, env = process.env) {
  if (dbPath) return workspaceFromDbPath(dbPath);

  return workspaceFromDbPath(defaultDbPath(env));
}

function requireWorkspace(cwd = process.cwd(), dbPath, env = process.env) {
  const workspace = findWorkspace(cwd, dbPath, env);
  if (!workspace) {
    if (dbPath) {
      throw new Error(`Relay database not found at ${path.resolve(dbPath)}. Run \`relay init --db ${path.resolve(dbPath)}\` first.`);
    }
    throw new Error(`No Relay database found. Run \`relay init\` to create ${defaultDbPath(env)}.`);
  }
  return workspace;
}

module.exports = {
  RELAY_DIR,
  DB_FILE,
  defaultDbPath,
  findWorkspace,
  requireWorkspace,
  workspaceFromDbPath,
  workspaceForInit,
};
