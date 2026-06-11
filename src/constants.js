const ROLES = ["admin", "pm", "developer", "reviewer", "tester"];
const RISK_LEVELS = ["low", "medium", "high"];
const CARD_STATUSES = [
  "draft",
  "pending_approval",
  "needs_changes",
  "ready",
  "in_progress",
  "review",
  "testing",
  "done",
  "rejected",
  "paused",
  "cancelled",
];
const APPROVAL_STATUSES = ["draft", "pending", "approved", "needs_changes", "rejected"];
const FEATURE_STATUSES = ["active", "paused", "done"];
const LAYER_TYPES = {
  project_map: { scopes: ["project"], bodyMax: 8000 },
  implementation_notes: { scopes: ["card"], bodyMax: 4000 },
  validation_evidence: { scopes: ["card"], bodyMax: 4000 },
  handoff_intent: { scopes: ["card"], bodyMax: 2000 },
};
const WIP_LIMITS = {
  ready: 8,
  in_progress: 3,
  review: 3,
  testing: 3,
};

module.exports = {
  APPROVAL_STATUSES,
  CARD_STATUSES,
  FEATURE_STATUSES,
  LAYER_TYPES,
  RISK_LEVELS,
  ROLES,
  WIP_LIMITS,
};
