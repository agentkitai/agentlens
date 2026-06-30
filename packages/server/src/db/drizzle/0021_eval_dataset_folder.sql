-- #224: dataset folders — additive `folder` column on eval_datasets (pg path).
-- Mirrors the sqlite ALTER in migrate.sqlite.ts. Raw-SQL-only table (not in the
-- drizzle schema modules) → no schema-drift impact.

ALTER TABLE eval_datasets ADD COLUMN IF NOT EXISTS folder text;
