-- #172 feature 8: llm_connections (BYO provider keys) on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts. Raw-SQL-only table
-- (not in the drizzle schema modules) → no schema-drift impact. Created here so
-- the dialect-agnostic LlmConnectionStore (same PR) works on Postgres. The
-- encrypted_key is AES-256-GCM ciphertext (lib/secret-box.ts), stored as text.

CREATE TABLE IF NOT EXISTS "llm_connections" (
  "id"            text PRIMARY KEY,
  "tenant_id"     text NOT NULL DEFAULT 'default',
  "provider"      text NOT NULL,
  "name"          text NOT NULL,
  "base_url"      text,
  "default_model" text,
  "encrypted_key" text NOT NULL,
  "key_last4"     text NOT NULL,
  "created_by"    text,
  "created_at"    text NOT NULL,
  "updated_at"    text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_llm_connections_tenant" ON "llm_connections" ("tenant_id");
