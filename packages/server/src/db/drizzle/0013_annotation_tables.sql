-- #172 feature 7: annotation tables on the Postgres path.
-- Mirrors the live SQLite columns from migrate.sqlite.ts (annotation_queues,
-- annotation_items incl. the queue FK + ON DELETE CASCADE). Raw-SQL-only tables
-- (not in the drizzle schema modules) → no schema-drift impact. Created here so
-- the dialect-agnostic AnnotationStore (same PR) works on Postgres.

CREATE TABLE IF NOT EXISTS "annotation_queues" (
  "id"          text PRIMARY KEY,
  "tenant_id"   text NOT NULL,
  "name"        text NOT NULL,
  "description" text,
  "config"      text NOT NULL DEFAULT '{}',
  "created_by"  text,
  "created_at"  text NOT NULL,
  "updated_at"  text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_annotation_queues_tenant" ON "annotation_queues" ("tenant_id");

CREATE TABLE IF NOT EXISTS "annotation_items" (
  "id"             text PRIMARY KEY,
  "queue_id"       text NOT NULL REFERENCES "annotation_queues"("id") ON DELETE CASCADE,
  "tenant_id"      text NOT NULL,
  "session_id"     text NOT NULL,
  "trace_id"       text,
  "status"         text NOT NULL DEFAULT 'pending',
  "assignee"       text,
  "due_at"         text,
  "score_event_id" text,
  "created_at"     text NOT NULL,
  "updated_at"     text NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_annotation_items_queue" ON "annotation_items" ("tenant_id", "queue_id", "status");
CREATE INDEX IF NOT EXISTS "idx_annotation_items_assignee" ON "annotation_items" ("tenant_id", "assignee");
