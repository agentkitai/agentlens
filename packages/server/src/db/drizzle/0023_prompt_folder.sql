-- #253: prompt folders — additive `folder` column on prompt_templates (pg path).
-- Mirrors the sqlite ALTER in migrate.sqlite.ts. Raw-SQL table → no schema-drift.

ALTER TABLE prompt_templates ADD COLUMN IF NOT EXISTS folder text;
