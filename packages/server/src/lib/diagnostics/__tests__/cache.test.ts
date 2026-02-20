/**
 * Tests for DiagnosticCache (Story 18.6)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticCache } from '../cache.js';
import type { DiagnosticReport } from '../types.js';

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    id: 'test-id',
    type: 'agent',
    targetId: 'agent-1',
    severity: 'warning',
    summary: 'Test summary',
    rootCauses: [],
    recommendations: [],
    healthScore: 65,
    analysisContext: { windowDays: 7, sessionCount: 10, dataPoints: 5 },
    llmMeta: {
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      estimatedCostUsd: 0.01,
      latencyMs: 3000,
    },
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    source: 'llm',
    ...overrides,
  };
}

describe('DiagnosticCache', () => {
  let cache: DiagnosticCache;

  beforeEach(() => {
    cache = new DiagnosticCache(1000, 5); // 1s TTL, max 5 entries
  });

  it('set and get returns value', () => {
    const report = makeReport();
    cache.set('key1', report);
    expect(cache.get('key1')).toEqual(report);
  });

  it('returns null for missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('returns null for expired entries', async () => {
    const shortCache = new DiagnosticCache(50, 10); // 50ms TTL
    shortCache.set('key1', makeReport());
    await new Promise((r) => setTimeout(r, 100));
    expect(shortCache.get('key1')).toBeNull();
  });

  it('evicts oldest when exceeding max entries', () => {
    for (let i = 0; i < 6; i++) {
      cache.set(`key${i}`, makeReport({ id: `report-${i}` }));
    }
    // First entry should be evicted
    expect(cache.get('key0')).toBeNull();
    expect(cache.get('key5')).not.toBeNull();
    expect(cache.size).toBe(5);
  });

  it('invalidate removes entry', () => {
    cache.set('key1', makeReport());
    cache.invalidate('key1');
    expect(cache.get('key1')).toBeNull();
  });

  it('clear removes all entries', () => {
    cache.set('key1', makeReport());
    cache.set('key2', makeReport());
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('buildKey produces different keys for different data hashes', () => {
    const k1 = DiagnosticCache.buildKey('agent', 'a1', 7, 'hash1');
    const k2 = DiagnosticCache.buildKey('agent', 'a1', 7, 'hash2');
    expect(k1).not.toBe(k2);
  });
});
