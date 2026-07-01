-- #253: per-tenant GitHub prompt-sync config (PAT encrypted via secret-box).
-- Raw-SQL table (not in the drizzle schema modules) → no schema-drift gate.

CREATE TABLE IF NOT EXISTS prompt_github_sync (
  tenant_id       TEXT PRIMARY KEY,
  owner           TEXT NOT NULL,
  repo            TEXT NOT NULL,
  base_path       TEXT NOT NULL DEFAULT 'prompts',
  encrypted_token TEXT NOT NULL,
  token_last4     TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
