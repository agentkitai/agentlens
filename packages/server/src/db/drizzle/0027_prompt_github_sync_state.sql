-- #265: last-synced snapshot per prompt (repo blob sha + local content hash) for
-- two-way GitHub sync conflict detection. Raw-SQL table → no schema-drift gate.

CREATE TABLE IF NOT EXISTS prompt_github_sync_state (
  tenant_id  TEXT NOT NULL,
  path       TEXT NOT NULL,
  repo_sha   TEXT NOT NULL,
  local_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, path)
);
