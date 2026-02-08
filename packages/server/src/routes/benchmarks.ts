/**
 * Benchmark REST Endpoints (Story 3.5)
 *
 * POST   /api/benchmarks            — Create benchmark
 * GET    /api/benchmarks            — List benchmarks
 * GET    /api/benchmarks/:id        — Get benchmark detail
 * PUT    /api/benchmarks/:id/status — Transition status
 * GET    /api/benchmarks/:id/results — Get comparison results
 * DELETE /api/benchmarks/:id        — Delete draft/cancelled
 */

import { Hono } from 'hono';
import type { IEventStore, BenchmarkMetric, BenchmarkStatus } from '@agentlensai/core';
import { BENCHMARK_METRICS } from '@agentlensai/core';
import type { AuthVariables } from '../middleware/auth.js';
import { getTenantStore } from './tenant-helper.js';
import {
  BenchmarkStore,
  type CreateBenchmarkInput,
  type ListBenchmarkFilters,
} from '../db/benchmark-store.js';
import { BenchmarkEngine } from '../lib/benchmark/engine.js';
import type { SqliteDb } from '../db/index.js';

// ─── Validation Helpers ────────────────────────────────────

const VALID_METRICS = new Set<string>(BENCHMARK_METRICS);

const VALID_STATUSES: Set<string> = new Set(['draft', 'running', 'completed', 'cancelled']);

function validateCreateInput(body: any): { error?: string; input?: CreateBenchmarkInput } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body is required' };
  }

  // Name required
  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    return { error: 'name is required and must be a non-empty string' };
  }

  // Variants: 2-10 with name+tag
  if (!Array.isArray(body.variants)) {
    return { error: 'variants must be an array' };
  }
  if (body.variants.length < 2 || body.variants.length > 10) {
    return { error: 'Must have between 2 and 10 variants' };
  }
  for (let i = 0; i < body.variants.length; i++) {
    const v = body.variants[i];
    if (!v || typeof v !== 'object') {
      return { error: `variants[${i}] must be an object` };
    }
    if (!v.name || typeof v.name !== 'string' || v.name.trim() === '') {
      return { error: `variants[${i}].name is required` };
    }
    if (!v.tag || typeof v.tag !== 'string' || v.tag.trim() === '') {
      return { error: `variants[${i}].tag is required` };
    }
  }

  // Metrics: optional array, but if provided must be valid
  let metrics: BenchmarkMetric[] = BENCHMARK_METRICS.filter(m => m !== 'health_score'); // default: all supported
  if (body.metrics !== undefined) {
    if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
      return { error: 'metrics must be a non-empty array' };
    }
    for (const m of body.metrics) {
      if (!VALID_METRICS.has(m)) {
        return { error: `Invalid metric: ${m}` };
      }
      if (m === 'health_score') {
        return { error: `Metric "health_score" is not yet supported for benchmarks. It requires pre-computed health snapshots.` };
      }
    }
    metrics = body.metrics;
  }

  // minSessionsPerVariant: optional, must be ≥ 1
  let minSessions: number | undefined;
  if (body.minSessionsPerVariant !== undefined) {
    const val = Number(body.minSessionsPerVariant);
    if (!Number.isInteger(val) || val < 1) {
      return { error: 'minSessionsPerVariant must be an integer ≥ 1' };
    }
    minSessions = val;
  }

  const input: CreateBenchmarkInput = {
    name: body.name.trim(),
    description: body.description ?? undefined,
    agentId: body.agentId ?? undefined,
    metrics,
    minSessionsPerVariant: minSessions,
    timeRange: body.timeRange,
    variants: body.variants.map((v: any) => ({
      name: v.name.trim(),
      description: v.description ?? undefined,
      tag: v.tag.trim(),
      agentId: v.agentId ?? undefined,
    })),
  };

  return { input };
}

// ─── Route Factory ─────────────────────────────────────────

export function benchmarkRoutes(store: IEventStore, db?: SqliteDb) {
  const app = new Hono<{ Variables: AuthVariables }>();
  const engine = new BenchmarkEngine();

  function getBenchmarkStore(c: any): BenchmarkStore | null {
    if (!db) return null;
    return new BenchmarkStore(db);
  }

  function getTenantId(c: any): string {
    const apiKey = c.get('apiKey');
    return apiKey?.tenantId ?? 'default';
  }

  // ─── POST / — Create benchmark ─────────────────────────

  app.post('/', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);
    const body = await c.req.json().catch(() => null);

    const { error, input } = validateCreateInput(body);
    if (error || !input) {
      return c.json({ error, status: 400 }, 400);
    }

    try {
      const benchmark = benchmarkStore.create(tenantId, input);
      return c.json(benchmark, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create benchmark';
      return c.json({ error: message, status: 400 }, 400);
    }
  });

  // ─── GET / — List benchmarks ────────────────────────────

  app.get('/', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);

    // Parse query params
    const statusRaw = c.req.query('status');
    const agentId = c.req.query('agentId') || undefined;
    const limitStr = c.req.query('limit');
    const offsetStr = c.req.query('offset');

    // Validate status
    let status: BenchmarkStatus | undefined;
    if (statusRaw) {
      if (!VALID_STATUSES.has(statusRaw)) {
        return c.json({ error: `Invalid status: ${statusRaw}`, status: 400 }, 400);
      }
      status = statusRaw as BenchmarkStatus;
    }

    // Validate limit (1-100, default 20)
    let limit = 20;
    if (limitStr !== undefined && limitStr !== '') {
      const val = parseInt(limitStr, 10);
      if (isNaN(val) || val < 1 || val > 100) {
        return c.json({ error: 'limit must be an integer between 1 and 100', status: 400 }, 400);
      }
      limit = val;
    }

    // Validate offset
    let offset = 0;
    if (offsetStr !== undefined && offsetStr !== '') {
      const val = parseInt(offsetStr, 10);
      if (isNaN(val) || val < 0) {
        return c.json({ error: 'offset must be a non-negative integer', status: 400 }, 400);
      }
      offset = val;
    }

    const filters: ListBenchmarkFilters = { status, agentId, limit, offset };
    const { benchmarks, total } = benchmarkStore.list(tenantId, filters);

    return c.json({
      benchmarks,
      total,
      hasMore: offset + benchmarks.length < total,
    });
  });

  // ─── GET /:id — Get benchmark detail ────────────────────

  app.get('/:id', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);
    const id = c.req.param('id');

    const benchmark = benchmarkStore.getById(tenantId, id);
    if (!benchmark) {
      return c.json({ error: 'Benchmark not found', status: 404 }, 404);
    }

    // Enrich variants with session counts
    const tenantStore = getTenantStore(store, c);
    const variantsWithCounts = await Promise.all(
      benchmark.variants.map(async (v) => {
        try {
          const { total } = await tenantStore.querySessions({
            tenantId: v.tenantId,
            agentId: v.agentId,
            tags: [v.tag],
            from: benchmark.timeRange?.from,
            to: benchmark.timeRange?.to,
            limit: 1, // Minimal fetch — we only need the count
          });
          return { ...v, sessionCount: total };
        } catch {
          return { ...v, sessionCount: 0 };
        }
      }),
    );

    return c.json({
      ...benchmark,
      variants: variantsWithCounts,
    });
  });

  // ─── PUT /:id/status — Transition status ────────────────

  app.put('/:id/status', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);

    if (!body || !body.status) {
      return c.json({ error: 'status is required', status: 400 }, 400);
    }

    if (!VALID_STATUSES.has(body.status)) {
      return c.json({ error: `Invalid status: ${body.status}`, status: 400 }, 400);
    }

    const newStatus = body.status as BenchmarkStatus;

    // Get current benchmark
    const current = benchmarkStore.getById(tenantId, id);
    if (!current) {
      return c.json({ error: 'Benchmark not found', status: 404 }, 404);
    }

    // When transitioning to "running": validate ≥1 session per variant
    if (newStatus === 'running') {
      const tenantStore = getTenantStore(store, c);
      for (const v of current.variants) {
        const { sessions } = await tenantStore.querySessions({
          tenantId: v.tenantId,
          agentId: v.agentId,
          tags: [v.tag],
          from: current.timeRange?.from,
          to: current.timeRange?.to,
          limit: 1,
        });
        if (sessions.length === 0) {
          return c.json(
            {
              error: `Variant "${v.name}" has no sessions. Each variant must have at least 1 session to start.`,
              status: 409,
            },
            409,
          );
        }
      }
    }

    try {
      const updated = benchmarkStore.updateStatus(tenantId, id, newStatus);

      // When transitioning to "completed": compute and cache results
      if (newStatus === 'completed') {
        const tenantStore = getTenantStore(store, c);
        await engine.computeResults(updated, tenantStore, benchmarkStore);
      }

      return c.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      if (message.includes('Invalid status transition')) {
        return c.json({ error: message, status: 409 }, 409);
      }
      return c.json({ error: message, status: 400 }, 400);
    }
  });

  // ─── GET /:id/results — Get comparison results ──────────

  app.get('/:id/results', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);
    const id = c.req.param('id');

    const benchmark = benchmarkStore.getById(tenantId, id);
    if (!benchmark) {
      return c.json({ error: 'Benchmark not found', status: 404 }, 404);
    }

    // Draft benchmarks can't have results
    if (benchmark.status === 'draft') {
      return c.json(
        { error: 'Cannot get results for a draft benchmark. Start it first.', status: 400 },
        400,
      );
    }

    const tenantStore = getTenantStore(store, c);
    const results = await engine.computeResults(benchmark, tenantStore, benchmarkStore);

    // Strip distributions unless requested
    const includeDistributions = c.req.query('includeDistributions') === 'true';
    if (!includeDistributions) {
      for (const v of results.variants) {
        for (const key of Object.keys(v.metrics)) {
          const stats = v.metrics[key as BenchmarkMetric];
          if (stats) {
            delete stats.values;
          }
        }
      }
    }

    return c.json(results);
  });

  // ─── DELETE /:id — Delete benchmark ─────────────────────

  app.delete('/:id', async (c) => {
    const benchmarkStore = getBenchmarkStore(c);
    if (!benchmarkStore) {
      return c.json({ error: 'Database not available', status: 500 }, 500);
    }

    const tenantId = getTenantId(c);
    const id = c.req.param('id');

    const benchmark = benchmarkStore.getById(tenantId, id);
    if (!benchmark) {
      return c.json({ error: 'Benchmark not found', status: 404 }, 404);
    }

    if (benchmark.status === 'running' || benchmark.status === 'completed') {
      return c.json(
        { error: `Cannot delete a ${benchmark.status} benchmark`, status: 409 },
        409,
      );
    }

    benchmarkStore.delete(tenantId, id);
    return c.body(null, 204);
  });

  return app;
}
