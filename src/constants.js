const ROLES = ["admin", "pm", "developer", "reviewer", "tester"];
const RISK_LEVELS = ["low", "medium", "high"];
const CARD_STATUSES = [
  "draft",
  "pending_approval",
  "needs_changes",
  "rejected",
  "ready",
  "in_progress",
  "review",
  "testing",
  "done",
  "paused",
  "cancelled",
];
const APPROVAL_STATUSES = ["draft", "pending", "approved", "needs_changes", "rejected"];
const FEATURE_STATUSES = ["active", "paused", "done"];

module.exports = {
  APPROVAL_STATUSES,
  CARD_STATUSES,
  FEATURE_STATUSES,
  RISK_LEVELS,
  ROLES,
};

