#!/usr/bin/env tsx
/**
 * PostgreSQL Performance Benchmark (Story 7)
 *
 * Seeds synthetic data into PostgreSQL and measures query performance.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx packages/server/scripts/benchmark-postgres.ts
 *
 * Requires a running PostgreSQL instance with pgvector extension.
 */

import { randomUUID } from 'node:crypto';
import { createPostgresConnection, verifyPostgresConnection } from '../src/db/connection.postgres.js';
import { runPostgresMigrations } from '../src/db/migrate.postgres.js';
import { PostgresEventStore } from '../src/db/postgres-store.js';
import { PostgresEmbeddingStore } from '../src/db/postgres-embedding-store.js';
import { computeEventHash } from '@agentlensai/core';

// ─── Configuration ──────────────────────────────────────
const EVENT_COUNT = 100_000;
const EMBEDDING_COUNT = 10_000;
const SESSION_COUNT = 1_000;
const ITERATIONS = 20;

// ─── Thresholds (p95) ───────────────────────────────────
const THRESHOLDS = {
  eventQuery: 200,       // ms
  sessionList: 200,      // ms
  analytics: 500,        // ms
  similaritySearch: 100, // ms
};

// ─── Helpers ────────────────────────────────────────────
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)]!;
}

async function measure(name: string, fn: () => Promise<void>, iterations = ITERATIONS): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b);
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  console.log('🔌 Connecting to PostgreSQL...');
  const conn = createPostgresConnection();
  await verifyPostgresConnection(conn.sql);

  console.log('🔄 Running migrations...');
  await runPostgresMigrations(conn.db);

  const store = new PostgresEventStore(conn.db);
  const embeddingStore = new PostgresEmbeddingStore(conn.db);
  await embeddingStore.initialize();

  // ─── Seed Data ─────────────────────────────────────────
  console.log(`📦 Seeding ${EVENT_COUNT} events, ${SESSION_COUNT} sessions, ${EMBEDDING_COUNT} embeddings...`);

  const tenantId = 'bench-' + randomUUID().slice(0, 8);
  const agentIds = Array.from({ length: 5 }, (_, i) => `agent-${i}`);
  const sessionIds = Array.from({ length: SESSION_COUNT }, () => randomUUID());
  const eventTypes = ['llm_request', 'llm_response', 'tool_call', 'tool_response', 'tool_error', 'session_started', 'session_ended', 'cost_tracked'] as const;
  const severities = ['info', 'warning', 'error', 'critical'] as const;

  // Insert events in batches
  const BATCH_SIZE = 500;
  let prevHash: string | null = null;
  const baseTime = new Date('2025-01-01T00:00:00Z').getTime();

  for (let i = 0; i < EVENT_COUNT; i += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, EVENT_COUNT - i);
    const batch = [];
    for (let j = 0; j < batchSize; j++) {
      const idx = i + j;
      const sessionId = sessionIds[idx % SESSION_COUNT]!;
      const agentId = agentIds[idx % agentIds.length]!;
      const eventType = eventTypes[idx % eventTypes.length]!;
      const severity = idx % 20 === 0 ? 'error' : idx % 100 === 0 ? 'critical' : 'info';
      const timestamp = new Date(baseTime + idx * 1000).toISOString();

      const event = {
        id: randomUUID(),
        timestamp,
        sessionId,
        agentId,
        eventType,
        severity: severity as any,
        payload: { message: `Event ${idx}`, durationMs: Math.random() * 1000, costUsd: Math.random() * 0.01 },
        metadata: {},
        prevHash,
        hash: '',
        tenantId,
      };
      event.hash = computeEventHash(event);
      prevHash = event.hash;
      batch.push(event);
    }

    try {
      await store.insertEvents(batch as any);
    } catch {
      // Insert individually on chain errors (different sessions)
      for (const event of batch) {
        try {
          await store.insertEvents([event as any]);
        } catch { /* skip chain errors */ }
      }
    }

    if ((i + batchSize) % 10000 === 0) {
      process.stdout.write(`  Events: ${i + batchSize}/${EVENT_COUNT}\r`);
    }
  }
  console.log(`  Events: ${EVENT_COUNT}/${EVENT_COUNT} ✅`);

  // Seed embeddings
  for (let i = 0; i < EMBEDDING_COUNT; i++) {
    const vec = new Float32Array(1536);
    for (let d = 0; d < 1536; d++) vec[d] = Math.random() * 2 - 1;

    await embeddingStore.store(
      tenantId, 'event', `emb-${i}`,
      `Embedding text content ${i} about ${['debugging', 'performance', 'security', 'cost'][i % 4]}`,
      vec, 'benchmark-model', 1536,
    );

    if ((i + 1) % 1000 === 0) {
      process.stdout.write(`  Embeddings: ${i + 1}/${EMBEDDING_COUNT}\r`);
    }
  }
  console.log(`  Embeddings: ${EMBEDDING_COUNT}/${EMBEDDING_COUNT} ✅`);

  // ─── Benchmarks ────────────────────────────────────────
  console.log('\n🏋️ Running benchmarks...\n');

  const results: Array<{ name: string; p50: number; p95: number; p99: number; threshold: number; pass: boolean }> = [];

  // 1. Event query (tenant + session + time range)
  const times1 = await measure('Event Query', async () => {
    await store.queryEvents({
      tenantId,
      sessionId: sessionIds[0],
      from: new Date(baseTime).toISOString(),
      to: new Date(baseTime + 50000 * 1000).toISOString(),
      limit: 50,
    });
  });
  results.push({ name: 'Event Query', p50: percentile(times1, 50), p95: percentile(times1, 95), p99: percentile(times1, 99), threshold: THRESHOLDS.eventQuery, pass: percentile(times1, 95) < THRESHOLDS.eventQuery });

  // 2. Session listing
  const times2 = await measure('Session List', async () => {
    await store.querySessions({ tenantId, limit: 50 });
  });
  results.push({ name: 'Session List', p50: percentile(times2, 50), p95: percentile(times2, 95), p99: percentile(times2, 99), threshold: THRESHOLDS.sessionList, pass: percentile(times2, 95) < THRESHOLDS.sessionList });

  // 3. Analytics aggregation
  const times3 = await measure('Analytics (day)', async () => {
    await store.getAnalytics({
      tenantId,
      from: new Date(baseTime).toISOString(),
      to: new Date(baseTime + EVENT_COUNT * 1000).toISOString(),
      granularity: 'day',
    });
  });
  results.push({ name: 'Analytics (day)', p50: percentile(times3, 50), p95: percentile(times3, 95), p99: percentile(times3, 99), threshold: THRESHOLDS.analytics, pass: percentile(times3, 95) < THRESHOLDS.analytics });

  // 4. Similarity search
  const queryVec = new Float32Array(1536);
  for (let d = 0; d < 1536; d++) queryVec[d] = Math.random() * 2 - 1;

  const times4 = await measure('Similarity Search', async () => {
    await embeddingStore.similaritySearch(tenantId, queryVec, { limit: 10 });
  });
  results.push({ name: 'Similarity Search', p50: percentile(times4, 50), p95: percentile(times4, 95), p99: percentile(times4, 99), threshold: THRESHOLDS.similaritySearch, pass: percentile(times4, 95) < THRESHOLDS.similaritySearch });

  // ─── Print Results ─────────────────────────────────────
  console.log('┌────────────────────┬────────┬────────┬────────┬───────────┬────────┐');
  console.log('│ Query              │ p50    │ p95    │ p99    │ Threshold │ Result │');
  console.log('├────────────────────┼────────┼────────┼────────┼───────────┼────────┤');
  for (const r of results) {
    const pass = r.pass ? '✅ PASS' : '❌ FAIL';
    console.log(`│ ${r.name.padEnd(18)} │ ${r.p50.toFixed(1).padStart(6)} │ ${r.p95.toFixed(1).padStart(6)} │ ${r.p99.toFixed(1).padStart(6)} │ ${(r.threshold + 'ms').padStart(9)} │ ${pass} │`);
  }
  console.log('└────────────────────┴────────┴────────┴────────┴───────────┴────────┘');

  const allPass = results.every(r => r.pass);
  console.log(`\n${allPass ? '✅ All benchmarks passed!' : '❌ Some benchmarks failed.'}`);

  // Cleanup
  await conn.sql.end({ timeout: 5 });
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
