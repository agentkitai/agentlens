-- #59: per-tenant service tokens (machine-to-machine auth for /api/internal),
-- replacing the org-wide AGENTGATE_SERVICE_TOKEN. Mirrors the sqlite table from
-- migrate.sqlite.ts. Raw-SQL-only (not in the drizzle schema modules) → no
-- schema-drift impact. Timestamps are unix SECONDS (int4-safe). Only the sha256
-- hash is stored; a token authorizes only its own tenant_id.

CREATE TABLE IF NOT EXISTS "service_tokens" (
  "id"           text PRIMARY KEY,
  "token_hash"   text NOT NULL,
  "tenant_id"    text NOT NULL DEFAULT 'default',
  "name"         text NOT NULL,
  "created_at"   integer NOT NULL,
  "last_used_at" integer,
  "revoked_at"   integer,
  "rotated_at"   integer,
  "expires_at"   integer,
  "created_by"   text
);
CREATE INDEX IF NOT EXISTS "idx_service_tokens_hash" ON "service_tokens" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_service_tokens_tenant" ON "service_tokens" ("tenant_id");
