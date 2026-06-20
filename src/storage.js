const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { CARD_STATUSES } = require("./constants");

const CARD_STATUS_ORDER_SQL = CARD_STATUSES.map((status, index) => `WHEN '${status}' THEN ${index}`).join("\n            ");

function openDatabase(dbPath) {
  fs.mkdirSync(require("node:path").dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  if (usesProjectFirstHierarchy(db)) {
    migrateFeatureFirstHierarchy(db);
  }

  createSchema(db);

  ensureColumn(db, "cards", "user_story", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "cards", "story_points", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "cards", "sprint", "TEXT NOT NULL DEFAULT ''");
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      feature_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      repo_path TEXT NOT NULL DEFAULT '',
      repo_remote TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      UNIQUE (feature_id, name)
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

    CREATE TABLE IF NOT EXISTS card_dependencies (
      card_id INTEGER NOT NULL,
      blocked_by_card_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (card_id, blocked_by_card_id),
      CHECK (card_id != blocked_by_card_id),
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (blocked_by_card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS card_dependencies_blocked_by
      ON card_dependencies(blocked_by_card_id);

    CREATE TABLE IF NOT EXISTS agent_heartbeats (
      agent TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      last_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      target_agent TEXT NOT NULL DEFAULT '',
      target_role TEXT NOT NULL DEFAULT '',
      read_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS notifications_unique_target
      ON notifications(event_id, target_agent, target_role);

    CREATE TABLE IF NOT EXISTS context_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      feature_id INTEGER,
      card_id INTEGER,
      layer_type TEXT NOT NULL,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      actor TEXT NOT NULL,
      role TEXT NOT NULL,
      supersedes_id INTEGER,
      superseded_by_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY (supersedes_id) REFERENCES context_layers(id),
      FOREIGN KEY (superseded_by_id) REFERENCES context_layers(id),
      CHECK ((project_id IS NOT NULL) + (feature_id IS NOT NULL) + (card_id IS NOT NULL) = 1)
    );

    CREATE INDEX IF NOT EXISTS context_layers_active
      ON context_layers(layer_type) WHERE superseded_by_id IS NULL;
  `);
}

function usesProjectFirstHierarchy(db) {
  if (!tableExists(db, "features") || !tableExists(db, "projects")) return false;
  const featureColumns = columnsFor(db, "features");
  const projectColumns = columnsFor(db, "projects");
  return featureColumns.includes("project_id") && !projectColumns.includes("feature_id");
}

function migrateFeatureFirstHierarchy(db) {
  const migrationTables = [
    "projects",
    "features",
    "cards",
    "events",
    "agent_heartbeats",
    "notifications",
    "context_layers",
  ].filter((table) => tableExists(db, table));

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of migrationTables) {
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_relay_old`);
    }

    createSchema(db);
    copyHierarchyData(db);
    copyTableRows(db, "events", [
      "id",
      "card_id",
      "actor",
      "role",
      "action",
      "message",
      "metadata",
      "created_at",
    ]);
    copyTableRows(db, "agent_heartbeats", ["agent", "role", "last_seen"]);
    copyTableRows(db, "notifications", [
      "id",
      "event_id",
      "card_id",
      "target_agent",
      "target_role",
      "read_at",
      "created_at",
    ]);
    copyContextLayers(db);

    for (const table of [...migrationTables].reverse()) {
      db.exec(`DROP TABLE ${table}_relay_old`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function copyHierarchyData(db) {
  const oldProjects = db.prepare("SELECT * FROM projects_relay_old ORDER BY id ASC").all();
  const oldFeatures = db
    .prepare(
      `
        SELECT
          features_relay_old.*,
          projects_relay_old.name AS project_name,
          projects_relay_old.description AS project_description,
          projects_relay_old.repo_path AS project_repo_path,
          projects_relay_old.repo_remote AS project_repo_remote,
          projects_relay_old.created_at AS project_created_at
        FROM features_relay_old
        JOIN projects_relay_old ON projects_relay_old.id = features_relay_old.project_id
        ORDER BY features_relay_old.id ASC
      `,
    )
    .all();

  const usedFeatureNames = new Set();
  const oldFeatureIds = new Set();
  const projectIdsWithFeatures = new Set();
  const insertFeature = db.prepare(`
    INSERT INTO features (id, name, summary, status, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertProject = db.prepare(`
    INSERT INTO projects (id, feature_id, name, description, repo_path, repo_remote, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const feature of oldFeatures) {
    const featureName = uniqueFeatureName(feature.name, feature.project_name, feature.id, usedFeatureNames);
    oldFeatureIds.add(feature.id);
    projectIdsWithFeatures.add(feature.project_id);

    insertFeature.run(feature.id, featureName, feature.summary, feature.status, feature.created_at);
    insertProject.run(
      feature.id,
      feature.id,
      feature.project_name,
      feature.project_description,
      feature.project_repo_path,
      feature.project_repo_remote,
      feature.project_created_at,
    );
  }

  let nextId = Math.max(0, ...oldFeatures.map((feature) => Number(feature.id) || 0)) + 1;
  for (const project of oldProjects) {
    if (projectIdsWithFeatures.has(project.id)) continue;
    const id = nextId;
    nextId += 1;
    const featureName = uniqueFeatureName(project.name, "Project", id, usedFeatureNames);
    oldFeatureIds.add(id);
    insertFeature.run(id, featureName, "", "active", project.created_at);
    insertProject.run(id, id, project.name, project.description, project.repo_path, project.repo_remote, project.created_at);
  }

  if (!tableExists(db, "cards_relay_old")) return;
  const insertCard = db.prepare(`
    INSERT INTO cards (
      id,
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
      assigned_role,
      assigned_agent,
      branch,
      commit_sha,
      pr_url,
      created_by_role,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const card of db.prepare("SELECT * FROM cards_relay_old ORDER BY id ASC").all()) {
    const featureId = card.feature_id;
    if (!oldFeatureIds.has(featureId)) continue;
    insertCard.run(
      card.id,
      featureId,
      featureId,
      card.title,
      card.user_story ?? "",
      card.problem_statement,
      card.acceptance_criteria,
      card.definition_of_done,
      card.target_repo,
      card.expected_role,
      card.risk_level,
      card.story_points ?? 0,
      card.sprint ?? "",
      card.status,
      card.approval_status,
      card.priority,
      card.assigned_role,
      card.assigned_agent,
      card.branch,
      card.commit_sha,
      card.pr_url,
      card.created_by_role,
      card.created_at,
      card.updated_at,
    );
  }
}

function uniqueFeatureName(name, parentName, id, usedFeatureNames) {
  let candidate = String(name || "").trim() || `Feature ${id}`;
  if (!usedFeatureNames.has(candidate)) {
    usedFeatureNames.add(candidate);
    return candidate;
  }

  const parentSuffix = String(parentName || "").trim();
  candidate = parentSuffix ? `${name} (${parentSuffix})` : `${name} (${id})`;
  if (!usedFeatureNames.has(candidate)) {
    usedFeatureNames.add(candidate);
    return candidate;
  }

  candidate = `${name} (${id})`;
  usedFeatureNames.add(candidate);
  return candidate;
}

function copyTableRows(db, table, columns) {
  const oldTable = `${table}_relay_old`;
  if (!tableExists(db, oldTable)) return;
  const columnList = columns.join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insert = db.prepare(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`);
  for (const row of db.prepare(`SELECT ${columnList} FROM ${oldTable} ORDER BY rowid ASC`).all()) {
    insert.run(...columns.map((column) => row[column]));
  }
}

function copyContextLayers(db) {
  if (!tableExists(db, "context_layers_relay_old")) return;
  const oldFeaturesByProject = new Map();
  if (tableExists(db, "features_relay_old")) {
    for (const feature of db.prepare("SELECT id, project_id FROM features_relay_old ORDER BY id ASC").all()) {
      const list = oldFeaturesByProject.get(feature.project_id) || [];
      list.push(feature.id);
      oldFeaturesByProject.set(feature.project_id, list);
    }
  }

  const insertWithId = db.prepare(`
    INSERT INTO context_layers (
      id,
      project_id,
      feature_id,
      card_id,
      layer_type,
      title,
      body_markdown,
      actor,
      role,
      supersedes_id,
      superseded_by_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWithoutId = db.prepare(`
    INSERT INTO context_layers (
      project_id,
      feature_id,
      card_id,
      layer_type,
      title,
      body_markdown,
      actor,
      role,
      supersedes_id,
      superseded_by_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const layer of db.prepare("SELECT * FROM context_layers_relay_old ORDER BY id ASC").all()) {
    if (layer.card_id || layer.feature_id) {
      insertWithId.run(
        layer.id,
        null,
        layer.feature_id || null,
        layer.card_id || null,
        layer.layer_type,
        layer.title,
        layer.body_markdown,
        layer.actor,
        layer.role,
        layer.supersedes_id || null,
        layer.superseded_by_id || null,
        layer.created_at,
      );
      continue;
    }

    const projectIds = oldFeaturesByProject.get(layer.project_id) || [];
    projectIds.forEach((projectId, index) => {
      const values = [
        projectId,
        null,
        null,
        layer.layer_type,
        layer.title,
        layer.body_markdown,
        layer.actor,
        layer.role,
        index === 0 ? layer.supersedes_id || null : null,
        index === 0 ? layer.superseded_by_id || null : null,
        layer.created_at,
      ];
      if (index === 0) {
        insertWithId.run(layer.id, ...values);
      } else {
        insertWithoutId.run(...values);
      }
    });
  }
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function columnsFor(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function ensureColumn(db, table, column, definition) {
  const columns = columnsFor(db, table);
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
    featureId: row.feature_id,
    featureName: row.feature_name,
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

function mapAgentHeartbeat(row) {
  if (!row) return null;
  return {
    agent: row.agent,
    role: row.role,
    lastSeen: row.last_seen,
  };
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventId: row.event_id,
    cardId: row.card_id,
    targetAgent: row.target_agent,
    targetRole: row.target_role,
    readAt: row.read_at,
    createdAt: row.created_at,
    event: {
      action: row.event_action,
      actor: row.event_actor,
      createdAt: row.event_created_at,
      message: row.event_message,
      role: row.event_role,
    },
    card: {
      id: row.card_id,
      featureName: row.feature_name,
      projectName: row.project_name,
      status: row.card_status,
      title: row.card_title,
    },
  };
}

function mapContextLayer(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    featureId: row.feature_id,
    cardId: row.card_id,
    layerType: row.layer_type,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    actor: row.actor,
    role: row.role,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    createdAt: row.created_at,
    scope: contextScope(row),
  };
}

function contextScope(row) {
  if (row.card_id) return "card";
  if (row.feature_id) return "feature";
  return "project";
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

  const notificationSql = `
    SELECT
      notifications.*,
      events.action AS event_action,
      events.actor AS event_actor,
      events.created_at AS event_created_at,
      events.message AS event_message,
      events.role AS event_role,
      cards.status AS card_status,
      cards.title AS card_title,
      projects.name AS project_name,
      features.name AS feature_name
    FROM notifications
    JOIN events ON events.id = notifications.event_id
    JOIN cards ON cards.id = notifications.card_id
    JOIN projects ON projects.id = cards.project_id
    JOIN features ON features.id = cards.feature_id
  `;

  function createProject(input) {
    const createdAt = now();
    const result = db
      .prepare(`
        INSERT INTO projects (feature_id, name, description, repo_path, repo_remote, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(input.featureId, input.name, input.description, input.repoPath, input.repoRemote, createdAt);

    return getProjectById(Number(result.lastInsertRowid));
  }

  function getProjectById(id) {
    return mapProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id));
  }

  function getProjectByName(featureId, name) {
    return mapProject(db.prepare("SELECT * FROM projects WHERE feature_id = ? AND name = ?").get(featureId, name));
  }

  function listProjects(featureId = null) {
    if (featureId) {
      return db.prepare("SELECT * FROM projects WHERE feature_id = ? ORDER BY name ASC").all(featureId).map(mapProject);
    }

    return db.prepare("SELECT * FROM projects ORDER BY name ASC").all().map(mapProject);
  }

  function listProjectsByName(name) {
    return db.prepare("SELECT * FROM projects WHERE name = ? ORDER BY id ASC").all(name).map(mapProject);
  }

  function createFeature(input) {
    const createdAt = now();
    const result = db
      .prepare(`
        INSERT INTO features (name, summary, status, created_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(input.name, input.summary, input.status, createdAt);

    return getFeatureById(Number(result.lastInsertRowid));
  }

  function getFeatureById(id) {
    return mapFeature(db.prepare("SELECT * FROM features WHERE id = ?").get(id));
  }

  function getFeatureByName(name) {
    return mapFeature(db.prepare("SELECT * FROM features WHERE name = ?").get(name));
  }

  function listFeatures() {
    return db.prepare("SELECT * FROM features ORDER BY name ASC").all().map(mapFeature);
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
            ${CARD_STATUS_ORDER_SQL}
            ELSE ${CARD_STATUSES.length}
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

  function claimReadyCard(id, input) {
    const updatedAt = now();
    const result = db.prepare(`
      UPDATE cards
      SET
        status = 'in_progress',
        approval_status = ?,
        assigned_role = ?,
        assigned_agent = ?,
        updated_at = ?
      WHERE id = ?
        AND status = 'ready'
        AND assigned_agent = ''
    `).run(input.approvalStatus, input.assignedRole, input.assignedAgent, updatedAt, id);

    if (result.changes === 0) return null;
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

  function updateCardScope(id, input) {
    const updatedAt = now();
    db.prepare(`
      UPDATE cards
      SET
        title = ?,
        user_story = ?,
        problem_statement = ?,
        acceptance_criteria = ?,
        definition_of_done = ?,
        target_repo = ?,
        expected_role = ?,
        risk_level = ?,
        story_points = ?,
        sprint = ?,
        priority = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
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
      input.priority,
      updatedAt,
      id,
    );

    return getCardById(id);
  }

  function replaceCardDependencies(cardId, blockedByIds) {
    const createdAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM card_dependencies WHERE card_id = ?").run(cardId);
      const insert = db.prepare(`
        INSERT INTO card_dependencies (card_id, blocked_by_card_id, created_at)
        VALUES (?, ?, ?)
      `);
      for (const blockedById of blockedByIds) insert.run(cardId, blockedById, createdAt);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return listCardDependencies(cardId);
  }

  function listCardDependencies(cardId) {
    return db
      .prepare(`
        SELECT
          cards.*,
          projects.name AS project_name,
          features.name AS feature_name
        FROM card_dependencies
        JOIN cards ON cards.id = card_dependencies.blocked_by_card_id
        JOIN projects ON projects.id = cards.project_id
        JOIN features ON features.id = cards.feature_id
        WHERE card_dependencies.card_id = ?
        ORDER BY card_dependencies.blocked_by_card_id ASC
      `)
      .all(cardId)
      .map(mapCard);
  }

  function listCardDependents(cardId) {
    return db
      .prepare(`
        SELECT
          cards.*,
          projects.name AS project_name,
          features.name AS feature_name
        FROM card_dependencies
        JOIN cards ON cards.id = card_dependencies.card_id
        JOIN projects ON projects.id = cards.project_id
        JOIN features ON features.id = cards.feature_id
        WHERE card_dependencies.blocked_by_card_id = ?
        ORDER BY card_dependencies.card_id ASC
      `)
      .all(cardId)
      .map(mapCard);
  }

  function upsertAgentHeartbeat(input) {
    const lastSeen = now();
    db.prepare(`
      INSERT INTO agent_heartbeats (agent, role, last_seen)
      VALUES (?, ?, ?)
      ON CONFLICT(agent) DO UPDATE SET
        role = excluded.role,
        last_seen = excluded.last_seen
    `).run(input.agent, input.role, lastSeen);

    return mapAgentHeartbeat(db.prepare("SELECT * FROM agent_heartbeats WHERE agent = ?").get(input.agent));
  }

  function listOnlineAgents(cutoffIso) {
    return db
      .prepare("SELECT * FROM agent_heartbeats WHERE last_seen >= ? ORDER BY last_seen DESC, agent ASC")
      .all(cutoffIso)
      .map(mapAgentHeartbeat);
  }

  function getAgentHeartbeat(agent) {
    return mapAgentHeartbeat(db.prepare("SELECT * FROM agent_heartbeats WHERE agent = ?").get(agent));
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

  function createContextLayer(input) {
    const result = db
      .prepare(`
        INSERT INTO context_layers (
          project_id,
          feature_id,
          card_id,
          layer_type,
          title,
          body_markdown,
          actor,
          role,
          supersedes_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.projectId ?? null,
        input.featureId ?? null,
        input.cardId ?? null,
        input.layerType,
        input.title,
        input.bodyMarkdown,
        input.actor,
        input.role,
        input.supersedesId ?? null,
        now(),
      );

    return getContextLayerById(Number(result.lastInsertRowid));
  }

  function supersedeContextLayer(id, input) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = getContextLayerById(id);
      if (!current) throw new Error(`Layer not found: ${id}`);
      if (current.supersededById) {
        throw new Error(`Layer ${id} already superseded by ${current.supersededById}.`);
      }

      const layer = createContextLayer({
        projectId: current.projectId,
        featureId: current.featureId,
        cardId: current.cardId,
        layerType: current.layerType,
        title: input.title ?? current.title,
        bodyMarkdown: input.bodyMarkdown,
        actor: input.actor,
        role: input.role,
        supersedesId: current.id,
      });

      db.prepare("UPDATE context_layers SET superseded_by_id = ? WHERE id = ?").run(layer.id, current.id);

      const storedEvent = addEvent({
        ...input.event,
        metadata: {
          ...input.event.metadata,
          layerId: layer.id,
          supersedesId: current.id,
        },
      });
      db.exec("COMMIT");

      return {
        layer: getContextLayerById(layer.id),
        superseded: getContextLayerById(current.id),
        event: storedEvent,
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function getContextLayerById(id) {
    return mapContextLayer(db.prepare("SELECT * FROM context_layers WHERE id = ?").get(id));
  }

  function listContextLayers(input = {}) {
    const clauses = [];
    const values = [];

    if (input.projectId) {
      clauses.push("project_id = ?");
      values.push(input.projectId);
    }

    if (input.featureId) {
      clauses.push("feature_id = ?");
      values.push(input.featureId);
    }

    if (input.cardId) {
      clauses.push("card_id = ?");
      values.push(input.cardId);
    }

    if (input.layerType) {
      clauses.push("layer_type = ?");
      values.push(input.layerType);
    }

    if (!input.includeSuperseded) {
      clauses.push("superseded_by_id IS NULL");
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    return db
      .prepare(`
        SELECT * FROM context_layers
        ${where}
        ORDER BY created_at DESC, id DESC
      `)
      .all(...values)
      .map(mapContextLayer);
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

  function listRecentSendBacks(featureId, limit = 3) {
    return db
      .prepare(`
        SELECT events.message
        FROM events
        JOIN cards ON cards.id = events.card_id
        WHERE cards.feature_id = ?
          AND events.action IN ('admin.needs_changes', 'admin.rejected')
          AND events.message != ''
        ORDER BY events.id DESC
        LIMIT ?
      `)
      .all(featureId, limit)
      .map((row) => row.message);
  }

  function listContextGaps() {
    return {
      missingFeatureBriefs: db
        .prepare(`
          SELECT features.*
          FROM features
          WHERE NOT EXISTS (
            SELECT 1
            FROM context_layers
            WHERE context_layers.feature_id = features.id
              AND context_layers.layer_type = 'feature_brief'
              AND context_layers.superseded_by_id IS NULL
          )
          ORDER BY features.name ASC
        `)
        .all()
        .map(mapFeature),
      missingProjectMaps: db
        .prepare(`
          SELECT projects.*, features.name AS feature_name
          FROM projects
          JOIN features ON features.id = projects.feature_id
          WHERE NOT EXISTS (
            SELECT 1
            FROM context_layers
            WHERE context_layers.project_id = projects.id
              AND context_layers.layer_type = 'project_map'
              AND context_layers.superseded_by_id IS NULL
          )
          ORDER BY features.name ASC, projects.name ASC
        `)
        .all()
        .map(mapProject),
      reviewWithoutNotes: listCardsMissingContextLayer("review", "implementation_notes"),
      reviewWithoutHumanSummary: listCardsMissingContextLayer("review", "human_review_summary"),
      testingWithoutEvidence: listCardsMissingContextLayer("testing", "validation_evidence"),
      testingWithoutHumanSummary: listCardsMissingContextLayer("testing", "human_review_summary"),
    };
  }

  function listCardsMissingContextLayer(status, layerType) {
    return db
      .prepare(`
        SELECT
          cards.*,
          projects.name AS project_name,
          features.name AS feature_name
        FROM cards
        JOIN projects ON projects.id = cards.project_id
        JOIN features ON features.id = cards.feature_id
        WHERE cards.status = ?
          AND NOT EXISTS (
            SELECT 1
            FROM context_layers
            WHERE context_layers.card_id = cards.id
              AND context_layers.layer_type = ?
              AND context_layers.superseded_by_id IS NULL
          )
        ORDER BY
          CASE cards.status
            ${CARD_STATUS_ORDER_SQL}
            ELSE ${CARD_STATUSES.length}
          END,
          cards.priority ASC,
          cards.updated_at DESC
      `)
      .all(status, layerType)
      .map(mapCard);
  }

  function addNotification(input) {
    const createdAt = now();
    db.prepare(`
      INSERT OR IGNORE INTO notifications (event_id, card_id, target_agent, target_role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.eventId, input.cardId, input.targetAgent || "", input.targetRole || "", createdAt);
  }

  function getNotificationById(id) {
    return mapNotification(db.prepare(`${notificationSql} WHERE notifications.id = ?`).get(id));
  }

  function listNotifications(input = {}) {
    const clauses = [];
    const values = [];

    if (input.agent && input.role) {
      clauses.push(
        "(notifications.target_agent = ? OR (notifications.target_agent = '' AND notifications.target_role = ?))",
      );
      values.push(input.agent, input.role);
    } else if (input.agent) {
      clauses.push("notifications.target_agent = ?");
      values.push(input.agent);
    } else if (input.role) {
      clauses.push("notifications.target_agent = '' AND notifications.target_role = ?");
      values.push(input.role);
    }

    if (input.unread) clauses.push("notifications.read_at = ''");

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    return db
      .prepare(`
        ${notificationSql}
        ${where}
        ORDER BY
          CASE WHEN notifications.read_at = '' THEN 0 ELSE 1 END,
          notifications.created_at DESC,
          notifications.id DESC
      `)
      .all(...values)
      .map(mapNotification);
  }

  function acknowledgeNotification(input) {
    const readAt = now();
    const clauses = ["id = ?"];
    const values = [input.id];

    if (input.agent && input.role) {
      clauses.push("(target_agent = ? OR (target_agent = '' AND target_role = ?))");
      values.push(input.agent, input.role);
    } else if (input.agent) {
      clauses.push("target_agent = ?");
      values.push(input.agent);
    } else if (input.role) {
      clauses.push("target_agent = '' AND target_role = ?");
      values.push(input.role);
    }

    const result = db.prepare(`
      UPDATE notifications
      SET read_at = CASE WHEN read_at = '' THEN ? ELSE read_at END
      WHERE ${clauses.join(" AND ")}
    `).run(readAt, ...values);

    if (result.changes === 0) return null;
    return getNotificationById(input.id);
  }

  function close() {
    db.close();
  }

  return {
    addEvent,
    addNotification,
    acknowledgeNotification,
    claimReadyCard,
    close,
    createCard,
    createContextLayer,
    createFeature,
    createProject,
    getCardById,
    getAgentHeartbeat,
    getContextLayerById,
    getFeatureByName,
    getNotificationById,
    getProjectByName,
    listProjectsByName,
    listCardDependencies,
    listCardDependents,
    listCards,
    listContextLayers,
    listContextGaps,
    listEvents,
    listFeatures,
    listNotifications,
    listOnlineAgents,
    listProjects,
    listRecentSendBacks,
    replaceCardDependencies,
    updateCardLinks,
    updateCardScope,
    updateCardState,
    supersedeContextLayer,
    upsertAgentHeartbeat,
  };
}

module.exports = {
  createStore,
  now,
};
