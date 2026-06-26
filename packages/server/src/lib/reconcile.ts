/**
 * Spend reconciliation (#89, Slice C) — the drift cross-check that makes
 * per-agent spend billing-grade.
 *
 * `costUsd` is frozen into the immutable event at ingest-time pricing, but the
 * pricing table is refreshed in place (refreshFromLiteLLM) with no retroactive
 * recompute. So stored sums can drift from a recompute at *current* pricing.
 * This module recomputes each cost-bearing event's cost from its token usage at
 * the current rates and reports the per-agent stored-vs-recomputed drift, plus a
 * threshold alert. Pure + deterministic (current pricing version is passed in)
 * so it is trivially testable; the route wires it to live pricing + signing.
 *
 * Provider invoices are per-ORG, not per-agent, so they can only validate the
 * aggregate — that optional cross-check is intentionally out of scope here (it
 * would belong at the org/total level, not per agent). See billing-grade-spend.md.
 */

import { costUsdDetailed, lookupModelCost } from '@agentkitai/agentlens-core';

/** A cost-bearing event row, already attributed to an agent id (incl. 'unattributed'). */
export interface ReconcileEventRow {
  agentId: string;
  payload: Record<string, unknown>;
  pricingVersion: string | null;
}

export interface AgentDrift {
  agentId: string;
  eventCount: number;
  /** Stored cost of *reconcilable* (priceable-at-current-pricing) events only. */
  storedUsd: number;
  recomputedUsd: number;
  /** recomputed − stored, over reconcilable events (positive = current pricing is higher than what was billed). */
  driftUsd: number;
  /** driftUsd / storedUsd (0 when stored is 0 and recomputed is 0; 1 when stored 0 but recomputed ≠ 0). */
  driftPct: number;
  /** Events whose ingest pricing fingerprint differs from the current one (priced under stale rates). */
  staleVersionCount: number;
  /** Events whose model is absent from the current pricing table — can't be repriced, so EXCLUDED
   *  from drift/alert (a $0 recompute would otherwise look like −100% drift). Surfaced, not trusted. */
  unpriceableCount: number;
  /** Stored cost of those unpriceable events (the gap reconciliation can't account for). */
  unpriceableUsd: number;
  /** |driftPct| exceeds the threshold (over reconcilable events only). */
  alert: boolean;
}

export interface ReconcileReport {
  threshold: number;
  currentPricingVersion: string;
  byAgent: AgentDrift[];
  totals: {
    eventCount: number;
    storedUsd: number;
    recomputedUsd: number;
    driftUsd: number;
    driftPct: number;
    unpriceableCount: number;
    unpriceableUsd: number;
    agentsAlerting: number;
  };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Drift fraction, guarding divide-by-zero: 0 stored + 0 recomputed → 0; 0 stored + nonzero → 1 (100%). */
function pct(driftUsd: number, storedUsd: number): number {
  if (storedUsd !== 0) return driftUsd / storedUsd;
  return driftUsd === 0 ? 0 : 1;
}

/**
 * Recompute every row's cost at current pricing and aggregate stored-vs-recomputed
 * drift per agent. `currentPricingVersion` is passed in (not read from the live
 * table) so the function stays pure/testable; `threshold` is the |driftPct| at
 * which an agent's row is flagged.
 */
export function reconcile(
  rows: ReconcileEventRow[],
  opts: { threshold: number; currentPricingVersion: string },
): ReconcileReport {
  const { threshold, currentPricingVersion } = opts;

  const acc = new Map<string, { eventCount: number; storedUsd: number; recomputedUsd: number; staleVersionCount: number; unpriceableCount: number; unpriceableUsd: number }>();

  for (const row of rows) {
    const p = row.payload;
    const model = typeof p['model'] === 'string' ? (p['model'] as string) : '';
    const storedUsd = num(p['costUsd']);

    const a = acc.get(row.agentId) ?? { eventCount: 0, storedUsd: 0, recomputedUsd: 0, staleVersionCount: 0, unpriceableCount: 0, unpriceableUsd: 0 };
    a.eventCount += 1;

    // A model absent from the current table can't be repriced — costUsdDetailed
    // would return $0 and look like −100% drift. Surface it separately instead of
    // billing a false alert.
    if (lookupModelCost(model) === undefined) {
      a.unpriceableCount += 1;
      a.unpriceableUsd += storedUsd;
      acc.set(row.agentId, a);
      continue;
    }

    // llm_response nests tokens under `usage`; cost_tracked puts them flat.
    const usage = (p['usage'] && typeof p['usage'] === 'object') ? (p['usage'] as Record<string, unknown>) : undefined;
    const inputTokens = num(usage?.['inputTokens'] ?? p['inputTokens']);
    const outputTokens = num(usage?.['outputTokens'] ?? p['outputTokens']);
    const cacheReadTokens = num(usage?.['cacheReadTokens']);
    const cacheWriteTokens = num(usage?.['cacheWriteTokens']);
    const recomputedUsd = costUsdDetailed(model, { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }).costUsd;

    a.storedUsd += storedUsd;
    a.recomputedUsd += recomputedUsd;
    if (row.pricingVersion !== null && row.pricingVersion !== currentPricingVersion) a.staleVersionCount += 1;
    acc.set(row.agentId, a);
  }

  const byAgent: AgentDrift[] = [];
  let tStored = 0, tRecomputed = 0, tEvents = 0, tUnpriceable = 0, tUnpriceableUsd = 0, agentsAlerting = 0;
  for (const [agentId, a] of acc) {
    const driftUsd = a.recomputedUsd - a.storedUsd;
    const driftPct = pct(driftUsd, a.storedUsd);
    const alert = Math.abs(driftPct) > threshold;
    if (alert) agentsAlerting += 1;
    tStored += a.storedUsd;
    tRecomputed += a.recomputedUsd;
    tEvents += a.eventCount;
    tUnpriceable += a.unpriceableCount;
    tUnpriceableUsd += a.unpriceableUsd;
    byAgent.push({
      agentId,
      eventCount: a.eventCount,
      storedUsd: a.storedUsd,
      recomputedUsd: a.recomputedUsd,
      driftUsd,
      driftPct,
      staleVersionCount: a.staleVersionCount,
      unpriceableCount: a.unpriceableCount,
      unpriceableUsd: a.unpriceableUsd,
      alert,
    });
  }
  // Largest absolute drift first — what an operator wants to see.
  byAgent.sort((x, y) => Math.abs(y.driftUsd) - Math.abs(x.driftUsd));

  const tDrift = tRecomputed - tStored;
  return {
    threshold,
    currentPricingVersion,
    byAgent,
    totals: {
      eventCount: tEvents,
      storedUsd: tStored,
      recomputedUsd: tRecomputed,
      driftUsd: tDrift,
      driftPct: pct(tDrift, tStored),
      unpriceableCount: tUnpriceable,
      unpriceableUsd: tUnpriceableUsd,
      agentsAlerting,
    },
  };
}
