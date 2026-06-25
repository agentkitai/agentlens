-- #87: billing-grade verified-agent attribution.
--
-- Dedicated, indexed column for the server-authoritative verified agent id.
-- DERIVED at insert from the already-hashed metadata.verifiedAgentId — it is
-- NOT part of the hash input, so the chain stays valid. NULL = unverified
-- (the "unattributed" bucket in billing-grade mode).

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "verified_agent_id" text;

-- Grouping index for spend/analytics in billing-grade mode (tenant + verified id, time-ranged).
CREATE INDEX IF NOT EXISTS "idx_events_tenant_verified_ts" ON "events" ("tenant_id", "verified_agent_id", "timestamp");
