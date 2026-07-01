-- #254: online-eval (LiveEvalEngine) config — sample live sessions + score them.
-- Raw-SQL table (not in the drizzle schema modules) → no schema-drift gate.

CREATE TABLE IF NOT EXISTS live_eval_config (
  tenant_id     TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0,
  sampling_rate REAL NOT NULL DEFAULT 0.1,
  scorer_type   TEXT NOT NULL DEFAULT 'regex',
  scorer_config TEXT NOT NULL DEFAULT '{}',
  updated_at    TEXT NOT NULL
);
