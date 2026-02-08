/**
 * Benchmark Store (Story 3.1)
 *
 * CRUD operations for benchmarks, variants, and cached results.
 * All operations are tenant-isolated.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { SqliteDb } from './index.js';
import type {
  Benchmark,
  BenchmarkMetric,
  BenchmarkStatus,
  BenchmarkVariant,
  BenchmarkResults,
  VariantMetrics,
  MetricComparison,
} from '@agentlensai/core';

// ─── DB Row Types ──────────────────────────────────────────

interface BenchmarkRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  agent_id: string | null;
  metrics: string;
  min_sessions_per_variant: number;
  time_range_from: string | null;
  time_range_to: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface VariantRow {
  id: string;
  benchmark_id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  tag: string;
  agent_id: string | null;
  sort_order: number;
}

interface ResultRow {
  id: string;
  benchmark_id: string;
  tenant_id: string;
  variant_metrics: string;
  comparisons: string;
  summary: string | null;
  computed_at: string;
}

// ─── Input Types ───────────────────────────────────────────

export interface CreateBenchmarkInput {
  name: string;
  description?: string;
  agentId?: string;
  metrics: BenchmarkMetric[];
  minSessionsPerVariant?: number;
  timeRange?: { from: string; to: string };
  variants: Array<{
    name: string;
    description?: string;
    tag: string;
    agentId?: string;
  }>;
}

export interface ListBenchmarkFilters {
  status?: BenchmarkStatus;
  agentId?: string;
  limit?: number;
  offset?: number;
}

/** Benchmark with its variants */
export interface BenchmarkWithVariants extends Benchmark {
  variants: BenchmarkVariant[];
}

// ─── Valid Status Transitions ──────────────────────────────

const VALID_TRANSITIONS: Record<string, BenchmarkStatus[]> = {
  draft: ['running', 'cancelled'],
  running: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// ─── Row Converters ────────────────────────────────────────

function rowToBenchmark(row: BenchmarkRow): Benchmark {
  const benchmark: Benchmark = {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    status: row.status as BenchmarkStatus,
    metrics: JSON.parse(row.metrics) as BenchmarkMetric[],
    minSessionsPerVariant: row.min_sessions_per_variant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.description) benchmark.description = row.description;
  if (row.agent_id) benchmark.agentId = row.agent_id;
  if (row.time_range_from && row.time_range_to) {
    benchmark.timeRange = { from: row.time_range_from, to: row.time_range_to };
  }
  if (row.completed_at) benchmark.completedAt = row.completed_at;
  return benchmark;
}

function rowToVariant(row: VariantRow): BenchmarkVariant {
  const variant: BenchmarkVariant = {
    id: row.id,
    benchmarkId: row.benchmark_id,
    tenantId: row.tenant_id,
    name: row.name,
    tag: row.tag,
    sortOrder: row.sort_order,
  };
  if (row.description) variant.description = row.description;
  if (row.agent_id) variant.agentId = row.agent_id;
  return variant;
}

// ─── Store Class ───────────────────────────────────────────

export class BenchmarkStore {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Create a benchmark with variants in a single transaction.
   * Validates 2-10 variants.
   */
  create(tenantId: string, input: CreateBenchmarkInput): BenchmarkWithVariants {
    if (input.variants.length < 2 || input.variants.length > 10) {
      throw new Error('Benchmark must have between 2 and 10 variants');
    }

    const benchmarkId = randomUUID();
    const now = new Date().toISOString();
    const metricsJson = JSON.stringify(input.metrics);

    // Use transaction via raw SQLite (Drizzle wraps better-sqlite3)
    const client = (this.db as any).$client;
    const txn = client.transaction(() => {
      this.db.run(sql`
        INSERT INTO benchmarks (id, tenant_id, name, description, status, agent_id, metrics, min_sessions_per_variant, time_range_from, time_range_to, created_at, updated_at)
        VALUES (
          ${benchmarkId}, ${tenantId}, ${input.name}, ${input.description ?? null},
          'draft', ${input.agentId ?? null}, ${metricsJson},
          ${input.minSessionsPerVariant ?? 10},
          ${input.timeRange?.from ?? null}, ${input.timeRange?.to ?? null},
          ${now}, ${now}
        )
      `);

      const variants: BenchmarkVariant[] = [];
      for (let i = 0; i < input.variants.length; i++) {
        const v = input.variants[i]!;
        const variantId = randomUUID();
        this.db.run(sql`
          INSERT INTO benchmark_variants (id, benchmark_id, tenant_id, name, description, tag, agent_id, sort_order)
          VALUES (
            ${variantId}, ${benchmarkId}, ${tenantId}, ${v.name}, ${v.description ?? null},
            ${v.tag}, ${v.agentId ?? null}, ${i}
          )
        `);
        const variant: BenchmarkVariant = {
          id: variantId,
          benchmarkId,
          tenantId,
          name: v.name,
          tag: v.tag,
          sortOrder: i,
        };
        if (v.description) variant.description = v.description;
        if (v.agentId) variant.agentId = v.agentId;
        variants.push(variant);
      }

      return variants;
    });

    const variants = txn();

    const benchmark: BenchmarkWithVariants = {
      id: benchmarkId,
      tenantId,
      name: input.name,
      status: 'draft',
      metrics: input.metrics,
      minSessionsPerVariant: input.minSessionsPerVariant ?? 10,
      createdAt: now,
      updatedAt: now,
      variants,
    };
    if (input.description) benchmark.description = input.description;
    if (input.agentId) benchmark.agentId = input.agentId;
    if (input.timeRange) benchmark.timeRange = input.timeRange;

    return benchmark;
  }

  /**
   * Get a benchmark by ID with its variants. Returns null if not found.
   */
  getById(tenantId: string, id: string): BenchmarkWithVariants | null {
    const row = this.db.get<BenchmarkRow>(sql`
      SELECT * FROM benchmarks WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    if (!row) return null;

    const variantRows = this.db.all<VariantRow>(sql`
      SELECT * FROM benchmark_variants
      WHERE benchmark_id = ${id} AND tenant_id = ${tenantId}
      ORDER BY sort_order ASC
    `);

    return {
      ...rowToBenchmark(row),
      variants: variantRows.map(rowToVariant),
    };
  }

  /**
   * List benchmarks with optional filters. Returns paginated results.
   */
  list(
    tenantId: string,
    filters: ListBenchmarkFilters = {},
  ): { benchmarks: BenchmarkWithVariants[]; total: number } {
    const { status, agentId, limit = 20, offset = 0 } = filters;

    // Build WHERE conditions dynamically
    let whereClause = sql`WHERE tenant_id = ${tenantId}`;
    if (status) {
      whereClause = sql`${whereClause} AND status = ${status}`;
    }
    if (agentId) {
      whereClause = sql`${whereClause} AND agent_id = ${agentId}`;
    }

    // Get total count
    const countRow = this.db.get<{ cnt: number }>(sql`
      SELECT COUNT(*) as cnt FROM benchmarks ${whereClause}
    `);
    const total = countRow?.cnt ?? 0;

    // Get paginated results
    const rows = this.db.all<BenchmarkRow>(sql`
      SELECT * FROM benchmarks ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Fetch variants for each benchmark
    const benchmarks = rows.map((row) => {
      const variantRows = this.db.all<VariantRow>(sql`
        SELECT * FROM benchmark_variants
        WHERE benchmark_id = ${row.id} AND tenant_id = ${tenantId}
        ORDER BY sort_order ASC
      `);
      return {
        ...rowToBenchmark(row),
        variants: variantRows.map(rowToVariant),
      };
    });

    return { benchmarks, total };
  }

  /**
   * Update benchmark status with transition validation.
   * Sets completedAt when transitioning to 'completed'.
   */
  updateStatus(tenantId: string, id: string, newStatus: BenchmarkStatus): BenchmarkWithVariants {
    const current = this.getById(tenantId, id);
    if (!current) {
      throw new Error(`Benchmark ${id} not found`);
    }

    const allowed = VALID_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${current.status} → ${newStatus}`,
      );
    }

    const now = new Date().toISOString();
    const completedAt = newStatus === 'completed' ? now : null;

    this.db.run(sql`
      UPDATE benchmarks
      SET status = ${newStatus}, updated_at = ${now},
          completed_at = COALESCE(${completedAt}, completed_at)
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);

    return this.getById(tenantId, id)!;
  }

  /**
   * Delete a benchmark. Only draft/cancelled can be deleted.
   * Returns true if deleted, false if the status doesn't allow deletion.
   */
  delete(tenantId: string, id: string): boolean {
    const current = this.getById(tenantId, id);
    if (!current) return false;

    if (current.status !== 'draft' && current.status !== 'cancelled') {
      return false;
    }

    this.db.run(sql`
      DELETE FROM benchmarks WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
    return true;
  }

  /**
   * Upsert benchmark results (cached computation results).
   */
  saveResults(tenantId: string, benchmarkId: string, results: BenchmarkResults): void {
    const id = randomUUID();
    const variantMetricsJson = JSON.stringify(results.variants);
    const comparisonsJson = JSON.stringify(results.comparisons);

    // Delete any existing results for this benchmark
    this.db.run(sql`
      DELETE FROM benchmark_results
      WHERE benchmark_id = ${benchmarkId} AND tenant_id = ${tenantId}
    `);

    this.db.run(sql`
      INSERT INTO benchmark_results (id, benchmark_id, tenant_id, variant_metrics, comparisons, summary, computed_at)
      VALUES (
        ${id}, ${benchmarkId}, ${tenantId},
        ${variantMetricsJson}, ${comparisonsJson},
        ${results.summary ?? null}, ${results.computedAt}
      )
    `);
  }

  /**
   * Get cached results for a benchmark, or null if none.
   */
  getResults(tenantId: string, benchmarkId: string): BenchmarkResults | null {
    const row = this.db.get<ResultRow>(sql`
      SELECT * FROM benchmark_results
      WHERE benchmark_id = ${benchmarkId} AND tenant_id = ${tenantId}
    `);
    if (!row) return null;

    return {
      benchmarkId: row.benchmark_id,
      tenantId: row.tenant_id,
      variants: JSON.parse(row.variant_metrics) as VariantMetrics[],
      comparisons: JSON.parse(row.comparisons) as MetricComparison[],
      summary: row.summary ?? '',
      computedAt: row.computed_at,
    };
  }
}
