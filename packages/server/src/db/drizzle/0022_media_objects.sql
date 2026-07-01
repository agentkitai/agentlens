-- #252: offloaded media blobs (base64 image/audio moved out of event payloads).
-- Raw-SQL table (not in the drizzle schema modules) → no schema-drift gate.

CREATE TABLE IF NOT EXISTS media_objects (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  data         TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_objects_tenant ON media_objects(tenant_id);
