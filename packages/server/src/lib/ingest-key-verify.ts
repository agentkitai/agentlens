/**
 * OTLP ingest-key verification (#24, Option 3).
 *
 * AgentGate issues a longer-lived, revocable, ingest-scoped credential
 * (agl_ingest_*) for OTLP exporters that can't refresh the 15-min agent JWT. The
 * exporter presents it as X-Agent-Ingest-Key; here we resolve it to a verified
 * agent id by calling AgentGate's POST /api/internal/verify-ingest-key with the
 * shared service token.
 *
 * Because AgentLens's verify is otherwise crypto-only-no-callback, this is the
 * one place AgentLens depends on AgentGate at ingest. We keep that dependency
 * cheap + safe: a short in-memory cache (so a revoked/rotated key stops
 * resolving within `RESOLVED_TTL_MS`) and FAIL-OPEN — any error/timeout resolves
 * to null (the span ingests unattributed, never mis-attributed). Off unless both
 * AGENTGATE_URL and AGENTGATE_SERVICE_TOKEN are configured.
 */

import { createHash } from 'node:crypto';
import { getConfig } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('IngestKeyVerify');

/** How long a resolved answer (an agent id OR AgentGate's explicit null) is trusted. */
const RESOLVED_TTL_MS = 60_000;
/** Shorter TTL for a transport error, so AgentGate recovery is picked up quickly. */
const ERROR_TTL_MS = 10_000;
/** Bound the AgentGate call so a slow/down AgentGate can't add tail latency to ingest. */
const VERIFY_TIMEOUT_MS = 2_000;
/** Cap the cache; past this we drop expired entries (low-cardinality in normal use). */
const MAX_CACHE = 10_000;

interface CacheEntry {
  agentId: string | null;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();

/** Cache by sha256 of the key so we don't retain plaintext secrets in the map. */
function cacheKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function prune(now: number): void {
  if (cache.size <= MAX_CACHE) return;
  for (const [k, v] of cache) {
    if (v.expiresAt <= now) cache.delete(k);
  }
  // Hard cap: if still over (every entry still within its TTL), evict oldest
  // first — the cache key is sha256 of the attacker-controlled X-Agent-Ingest-Key
  // header, so a flood of distinct garbage keys must not grow the Map unbounded.
  // ponytail: FIFO via Map insertion order, not true LRU — fine for a verify cache.
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHE) break;
    cache.delete(k);
  }
}

/** Test hook: clear the cache. */
export function _resetIngestKeyCache(): void {
  cache.clear();
}

/** Test hook: current cache size (to assert the hard cap). */
export function _ingestKeyCacheSize(): number {
  return cache.size;
}

/**
 * Resolve an OTLP ingest key → a verified agent id, or null. Server-authoritative
 * (the id comes from AgentGate, never from the request). Returns null — never
 * throws — when the feature is unconfigured, the key is invalid/revoked, or
 * AgentGate is unreachable (fail-open → unattributed).
 */
export async function verifyIngestKey(key: string | undefined | null): Promise<string | null> {
  if (!key) return null;
  const cfg = getConfig();
  if (!cfg.agentgateUrl || !cfg.agentgateServiceToken) return null;

  const now = Date.now();
  const ck = cacheKey(key);
  const hit = cache.get(ck);
  if (hit && hit.expiresAt > now) return hit.agentId;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.agentgateUrl.replace(/\/$/, '')}/api/internal/verify-ingest-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.agentgateServiceToken}` },
      body: JSON.stringify({ ingestKey: key }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // A 4xx/5xx is an authoritative-ish "can't resolve right now" — cache the
      // null briefly to avoid hammering, fail-open.
      prune(now);
      cache.set(ck, { agentId: null, expiresAt: now + ERROR_TTL_MS });
      log.warn(`verify-ingest-key returned HTTP ${res.status}; treating as unattributed`);
      return null;
    }
    const body = (await res.json().catch(() => null)) as { agentId?: unknown } | null;
    const agentId = typeof body?.agentId === 'string' && body.agentId.length > 0 ? body.agentId : null;
    prune(now);
    cache.set(ck, { agentId, expiresAt: now + RESOLVED_TTL_MS });
    return agentId;
  } catch (err) {
    // Timeout / network error → fail-open to unattributed, cache briefly.
    prune(now);
    cache.set(ck, { agentId: null, expiresAt: now + ERROR_TTL_MS });
    log.warn(`verify-ingest-key unreachable (${err instanceof Error ? err.message : String(err)}); treating as unattributed`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
