-- #260: bind a cloud API key to a project. Defaults to org_id (an org-scoped key)
-- for existing keys; gateway.enrichEvent then stamps the key's project on ingested
-- events, and the tolerant project RLS predicate (010) isolates them. Idempotent.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS project_id UUID;
UPDATE api_keys SET project_id = org_id WHERE project_id IS NULL;
