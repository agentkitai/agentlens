-- #172 feature 11 (final): notification tables on the Postgres path.
-- Mirrors the schema.postgres.ts definitions (these tables are drizzle parity-
-- defs in both schema modules but were never created by a pg migration). Note
-- `enabled` is boolean here (matching schema.postgres.ts) vs INTEGER on sqlite —
-- NotificationChannelRepository binds/reads it per-dialect.

CREATE TABLE IF NOT EXISTS "notification_channels" (
  "id"         text PRIMARY KEY,
  "tenant_id"  text NOT NULL DEFAULT 'default',
  "type"       text NOT NULL,
  "name"       text NOT NULL,
  "config"     text NOT NULL,
  "enabled"    boolean NOT NULL DEFAULT true,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_pg_notification_channels_tenant" ON "notification_channels" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_pg_notification_channels_type" ON "notification_channels" ("tenant_id", "type");

CREATE TABLE IF NOT EXISTS "notification_log" (
  "id"              text PRIMARY KEY,
  "tenant_id"       text NOT NULL DEFAULT 'default',
  "channel_id"      text NOT NULL,
  "rule_id"         text,
  "rule_type"       text,
  "status"          text NOT NULL,
  "attempt"         integer NOT NULL DEFAULT 1,
  "error_message"   text,
  "payload_summary" text,
  "created_at"      text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_pg_notification_log_tenant" ON "notification_log" ("tenant_id");
CREATE INDEX IF NOT EXISTS "idx_pg_notification_log_channel" ON "notification_log" ("channel_id");
CREATE INDEX IF NOT EXISTS "idx_pg_notification_log_created" ON "notification_log" ("tenant_id", "created_at");
