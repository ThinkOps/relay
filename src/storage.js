const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function openDatabase(dbPath) {
  fs.mkdirSync(require("node:path").dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      repo_path TEXT NOT NULL DEFAULT '',
      repo_remote TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE (project_id, name)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      feature_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      user_story TEXT NOT NULL DEFAULT '',
      problem_statement TEXT NOT NULL,
      acceptance_criteria TEXT NOT NULL,
      definition_of_done TEXT NOT NULL,
      target_repo TEXT NOT NULL,
      expected_role TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      story_points INTEGER NOT NULL DEFAULT 0,
      sprint TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      approval_status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 3,
      assigned_role TEXT NOT NULL DEFAULT '',
      assigned_agent TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      commit_sha TEXT NOT NULL DEFAULT '',
      pr_url TEXT NOT NULL DEFAULT '',
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER,
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);

  ensureColumn(db, "cards", "user_story", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "cards", "story_points", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "cards", "sprint", "TEXT NOT NULL DEFAULT ''");
}

function ensureColumn(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function now() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoPath: row.repo_path,
    repoRemote: row.repo_remote,
    createdAt: row.created_at,
  };
}

function mapFeature(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    summary: row.summary,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    featureId: row.feature_id,
    projectName: row.project_name,
    featureName: row.feature_name,
    title: row.title,
    userStory: row.user_story,
    problemStatement: row.problem_statement,
    acceptanceCriteria: parseJson(row.acceptance_criteria, []),
    definitionOfDone: row.definition_of_done,
    targetRepo: row.target_repo,
    expectedRole: row.expected_role,
    riskLevel: row.risk_level,
    storyPoints: row.story_points,
    sprint: row.sprint,
    status: row.status,
    approvalStatus: row.approval_status,
    priority: row.priority,
    assignedRole: row.assigned_role,
    assignedAgent: row.assigned_agent,
    branch: row.branch,
    commitSha: row.commit_sha,
    prUrl: row.pr_url,
    createdByRole: row.created_by_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    cardId: row.card_id,
    actor: row.actor,
    role: row.role,
    action: row.action,
    message: row.message,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at,
  };
}

function createStore(dbPath) {
  const db = openDatabase(dbPath);

  const getCardSql = `
    SELECT
      cards.*,
      projects.name AS project_name,
      features.name AS feature_name
    FROM cards
    JOIN projects ON projects.id = cards.project_id
    JOIN features ON features.id = cards.feature_id
    WHERE cards.id = ?
  `;

  function createProject(input) {
    const createdAt = now();
    const result = db
      .prepare(`
        INSERT INTO projects (name, description, repo_path, repo_remote, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(input.name, input.description, input.repoPath, input.repoRemote, createdAt);

    return getProjectById(Number(result.lastInsertRowid));
  }

  function getProjectById(id) {
    return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  function getProjectByName(name) {
    return mapProject(db.prepare("SELECT * FROM projects WHERE name = ?").get(name));
  }

  function listProjects() {
    return db.prepare("SELECT * FROM projects ORDER BY name ASC").all().map(mapProject);
  }

  function createFeature(input) {
    const createdAt = now();
    const result = db
      .prepare(`
        INSERT INTO features (project_id, name, summary, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(input.projectId, input.name, input.summary, input.status, createdAt);

    return getFeatureById(Number(result.lastInsertRowid));
  }

  function getFeatureById(id) {
    return mapFeature(db.prepare("SELECT * FROM features WHERE id = ?").get(id));
  }

  function getFeatureByName(projectId, name) {
    return mapFeature(
      db.prepare("SELECT * FROM features WHERE project_id = ? AND name = ?").get(projectId, name),
    );
  }

  function listFeatures(projectId) {
    return db
      .prepare("SELECT * FROM features WHERE project_id = ? ORDER BY name ASC")
      .all(projectId)
      .map(mapFeature);
  }

  function createCard(input) {
    const createdAt = now();
    const result = db
      .prepare(`
        INSERT INTO cards (
          project_id,
          feature_id,
          title,
          user_story,
          problem_statement,
          acceptance_criteria,
          definition_of_done,
          target_repo,
          expected_role,
          risk_level,
          story_points,
          sprint,
          status,
          approval_status,
          priority,
          branch,
          commit_sha,
          created_by_role,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.projectId,
        input.featureId,
        input.title,
        input.userStory,
        input.problemStatement,
        JSON.stringify(input.acceptanceCriteria),
        input.definitionOfDone,
        input.targetRepo,
        input.expectedRole,
        input.riskLevel,
        input.storyPoints,
        input.sprint,
        input.status,
        input.approvalStatus,
        input.priority,
        input.branch,
        input.commitSha,
        input.createdByRole,
        createdAt,
        createdAt,
      );

    return getCardById(Number(result.lastInsertRowid));
  }

  function getCardById(id) {
    return mapCard(db.prepare(getCardSql).get(id));
  }

  function listCards(filters = {}) {
    const clauses = [];
    const values = [];

    if (filters.status) {
      clauses.push("cards.status = ?");
      values.push(filters.status);
    }

    if (filters.approvalStatus) {
      clauses.push("cards.approval_status = ?");
      values.push(filters.approvalStatus);
    }

    if (filters.projectId) {
      clauses.push("cards.project_id = ?");
      values.push(filters.projectId);
    }

    if (filters.featureId) {
      clauses.push("cards.feature_id = ?");
      values.push(filters.featureId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    return db
      .prepare(`
        SELECT
          cards.*,
          projects.name AS project_name,
          features.name AS feature_name
        FROM cards
        JOIN projects ON projects.id = cards.project_id
        JOIN features ON features.id = cards.feature_id
        ${where}
        ORDER BY
          CASE cards.status
            WHEN 'pending_approval' THEN 0
            WHEN 'needs_changes' THEN 1
            WHEN 'ready' THEN 2
            WHEN 'in_progress' THEN 3
            WHEN 'review' THEN 4
            WHEN 'testing' THEN 5
            WHEN 'done' THEN 6
            ELSE 7
          END,
          cards.priority ASC,
          cards.updated_at DESC
      `)
      .all(...values)
      .map(mapCard);
  }

  function updateCardState(id, input) {
    const updatedAt = now();
    db.prepare(`
      UPDATE cards
      SET
        status = ?,
        approval_status = ?,
        assigned_role = ?,
        assigned_agent = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.approvalStatus,
      input.assignedRole,
      input.assignedAgent,
      updatedAt,
      id,
    );

    return getCardById(id);
  }

  function updateCardLinks(id, input) {
    const updatedAt = now();
    db.prepare(`
      UPDATE cards
      SET branch = ?, commit_sha = ?, pr_url = ?, updated_at = ?
      WHERE id = ?
    `).run(input.branch, input.commitSha, input.prUrl, updatedAt, id);

    return getCardById(id);
  }

  function addEvent(input) {
    const result = db
      .prepare(`
        INSERT INTO events (card_id, actor, role, action, message, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.cardId ?? null,
        input.actor,
        input.role,
        input.action,
        input.message,
        JSON.stringify(input.metadata ?? {}),
        now(),
      );

    return getEventById(Number(result.lastInsertRowid));
  }

  function getEventById(id) {
    return mapEvent(db.prepare("SELECT * FROM events WHERE id = ?").get(id));
  }

  function listEvents(cardId) {
    return db
      .prepare("SELECT * FROM events WHERE card_id = ? ORDER BY id ASC")
      .all(cardId)
      .map(mapEvent);
  }

  function close() {
    db.close();
  }

  return {
    addEvent,
    close,
    createCard,
    createFeature,
    createProject,
    getCardById,
    getFeatureByName,
    getProjectByName,
    listCards,
    listEvents,
    listFeatures,
    listProjects,
    updateCardLinks,
    updateCardState,
  };
}

module.exports = {
  createStore,
  now,
};
