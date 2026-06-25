-- #89: pricing provenance for billing-grade reconciliation.
--
-- A fingerprint of the active pricing table at ingest, stamped server-side on
-- cost-bearing events (cost_tracked / llm_response). Lets the reconciliation
-- report tell whether a stored cost predates a price change. NULL for
-- non-cost events. Not indexed — reconciliation scans by tenant + window +
-- event_type (already indexed) and reads this column per row.

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "pricing_version" text;
