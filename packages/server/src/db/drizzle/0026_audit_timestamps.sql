-- #99: RFC 3161 trusted-timestamp tokens anchoring audit-export digests.
-- Raw-SQL table (not in the drizzle schema modules) → no schema-drift gate.

CREATE TABLE IF NOT EXISTS audit_timestamps (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  tsa_url      TEXT NOT NULL,
  token        TEXT NOT NULL,
  gen_time     TEXT,
  granted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamps_tenant ON audit_timestamps(tenant_id);
