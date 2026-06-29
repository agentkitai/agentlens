# Scale & retention (#124)

Fast analytics over long ranges, and safe purge of old raw events — without
surrendering tamper-evidence or per-agent cost accuracy.

## OLAP read path — `cost_rollups`

Events are aggregated into **hourly buckets** keyed on
`(tenant_id, verified_agent_id, model, bucket_start, granularity='hour')`. Each
bucket holds `event_count`, `tool_call_count`, `error_count`, `llm_call_count`,
input/output/cache tokens, `cost_usd`, `latency_sum_ms` + `latency_count`, and
the set of contributing `pricing_versions`.

- **Write:** incremental, inside the ingest transaction
  (`event-repository.insertEvents` → `lib/rollup.applyRollupBatch`). The batch is
  pre-aggregated in memory (one upsert per distinct bucket, not per event) and
  merged read-modify-write so count sums and the pricing-version union are exact.
  It is **best-effort**: a rollup failure never breaks ingest (events still
  commit; retention/backfill reconciles).
- **Read:** `analytics-repository.getRollupAnalytics(...)` re-buckets the hourly
  grain to hour/day and returns bucketed + per-agent + total cost/usage. Exposed
  at `GET /api/analytics/rollup`. Keyed on **`verified_agent_id`** (billing-grade
  attribution), so totals survive a raw-event purge. Sub-bucket / unique-session
  / drill-down queries stay on the raw `events` path.

Parity: rollup totals equal a raw-event recompute over the same range (tested).

## Chain anchors — `chain_anchors`

A signed checkpoint over a contiguous chain segment lets a cold range be verified
(and safely purged) without a full chain walk.

Anchor body (HMAC-signed with `AUDIT_SIGNING_KEY`, canonical JSON):
`{ tenantId, scope:'session', sessionId, firstPrevHash, lastHash, eventCount,
segmentDigest, chained, tsMin, tsMax, pricingVersions[], verifiedAgentIds[] }`.
`segmentDigest` = SHA-256 over the ordered event hashes. `chained=false` for
OTLP-style segments (all `prevHash=null`), which are verified by record integrity
(`verifyRecords`) rather than as a linear chain.

## Retention / rollup ordering (the safety invariant)

`retention-service.applyRetention(olderThan, tenantId?)`, per affected session:

1. Load the expired prefix (`timestamp <= olderThan`), ordered.
2. **Verify** the segment (`verifyChain`, or `verifyRecords` if unchained).
   A broken/tampered segment is **skipped, never purged** (`skippedSegments`).
3. **Anchor first, then delete** — in one transaction: insert the signed
   `chain_anchors` row, *then* `DELETE` the raw events. Raw rows are never deleted
   without a covering anchor.

Cost survives because the rollup already covered those events at ingest;
`cost_rollups` rows are not deleted by retention, and their retained
`pricing_versions` keep `lib/reconcile` drift computable after purge.

## Deferred (cloud-path follow-ups)

- Postgres rollup schema + `postgres-adapter` rollup routing; the pluggable OLAP
  analytics adapter seam.
- Cloud `batch-writer` hashing reconciled to the canonical content-bound chain
  (today it is a per-org arrival chain — see the epic).
- Scheduled rollup/backfill worker + `rollupWatermark`; cloud `retention-job`
  alignment (partition drops gated on rollup+anchor coverage).
- RFC-3161 external anchoring of checkpoints — #99 (the signature type is already
  pluggable).
