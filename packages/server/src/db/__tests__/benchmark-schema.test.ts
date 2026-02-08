import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, type SqliteDb } from '../index.js';
import { runMigrations } from '../migrate.js';

describe('Benchmark Database Schema (Story 1.3)', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
  });

  afterEach(() => {
    // @ts-expect-error accessing internal session for cleanup
    db.$client?.close?.();
  });

  describe('table creation', () => {
    it('should create benchmarks table', () => {
      const tables = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name='benchmarks'`,
      );
      expect(tables).toHaveLength(1);
    });

    it('should create benchmark_variants table', () => {
      const tables = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_variants'`,
      );
      expect(tables).toHaveLength(1);
    });

    it('should create benchmark_results table', () => {
      const tables = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' AND name='benchmark_results'`,
      );
      expect(tables).toHaveLength(1);
    });
  });

  describe('benchmarks table columns', () => {
    it('should have all required columns', () => {
      const columns = db.all<{ name: string; type: string; notnull: number }>(
        sql`PRAGMA table_info(benchmarks)`,
      );
      const colMap = new Map(columns.map((c) => [c.name, c]));

      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('tenant_id')).toBe(true);
      expect(colMap.has('name')).toBe(true);
      expect(colMap.has('description')).toBe(true);
      expect(colMap.has('status')).toBe(true);
      expect(colMap.has('agent_id')).toBe(true);
      expect(colMap.has('metrics')).toBe(true);
      expect(colMap.has('min_sessions_per_variant')).toBe(true);
      expect(colMap.has('time_range_from')).toBe(true);
      expect(colMap.has('time_range_to')).toBe(true);
      expect(colMap.has('created_at')).toBe(true);
      expect(colMap.has('updated_at')).toBe(true);
      expect(colMap.has('completed_at')).toBe(true);

      // NOT NULL constraints
      expect(colMap.get('tenant_id')!.notnull).toBe(1);
      expect(colMap.get('name')!.notnull).toBe(1);
      expect(colMap.get('status')!.notnull).toBe(1);
      expect(colMap.get('created_at')!.notnull).toBe(1);
      expect(colMap.get('updated_at')!.notnull).toBe(1);

      // Nullable columns
      expect(colMap.get('description')!.notnull).toBe(0);
      expect(colMap.get('agent_id')!.notnull).toBe(0);
      expect(colMap.get('completed_at')!.notnull).toBe(0);
    });
  });

  describe('benchmark_variants table columns', () => {
    it('should have all required columns', () => {
      const columns = db.all<{ name: string; type: string; notnull: number }>(
        sql`PRAGMA table_info(benchmark_variants)`,
      );
      const colMap = new Map(columns.map((c) => [c.name, c]));

      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('benchmark_id')).toBe(true);
      expect(colMap.has('tenant_id')).toBe(true);
      expect(colMap.has('name')).toBe(true);
      expect(colMap.has('description')).toBe(true);
      expect(colMap.has('tag')).toBe(true);
      expect(colMap.has('agent_id')).toBe(true);
      expect(colMap.has('sort_order')).toBe(true);

      expect(colMap.get('benchmark_id')!.notnull).toBe(1);
      expect(colMap.get('tenant_id')!.notnull).toBe(1);
      expect(colMap.get('name')!.notnull).toBe(1);
      expect(colMap.get('tag')!.notnull).toBe(1);
    });
  });

  describe('benchmark_results table columns', () => {
    it('should have all required columns', () => {
      const columns = db.all<{ name: string; type: string; notnull: number }>(
        sql`PRAGMA table_info(benchmark_results)`,
      );
      const colMap = new Map(columns.map((c) => [c.name, c]));

      expect(colMap.has('id')).toBe(true);
      expect(colMap.has('benchmark_id')).toBe(true);
      expect(colMap.has('tenant_id')).toBe(true);
      expect(colMap.has('variant_metrics')).toBe(true);
      expect(colMap.has('comparisons')).toBe(true);
      expect(colMap.has('summary')).toBe(true);
      expect(colMap.has('computed_at')).toBe(true);

      expect(colMap.get('benchmark_id')!.notnull).toBe(1);
      expect(colMap.get('tenant_id')!.notnull).toBe(1);
      expect(colMap.get('computed_at')!.notnull).toBe(1);
    });
  });

  describe('indexes', () => {
    it('should create all benchmark indexes', () => {
      const indexes = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_benchmark%' ORDER BY name`,
      );
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_benchmarks_tenant_id');
      expect(indexNames).toContain('idx_benchmarks_tenant_status');
      expect(indexNames).toContain('idx_benchmark_variants_benchmark_id');
      expect(indexNames).toContain('idx_benchmark_variants_tenant_tag');
      expect(indexNames).toContain('idx_benchmark_results_benchmark_id');
      expect(indexNames).toContain('idx_benchmark_results_tenant_id');
    });
  });

  describe('cascade deletes', () => {
    it('should cascade delete variants when benchmark is deleted', () => {
      // Insert a benchmark
      db.run(sql`
        INSERT INTO benchmarks (id, tenant_id, name, status, metrics, min_sessions_per_variant, created_at, updated_at)
        VALUES ('bench-1', 'tenant-1', 'Test Benchmark', 'draft', '["avg_cost"]', 10, '2026-02-08T12:00:00Z', '2026-02-08T12:00:00Z')
      `);

      // Insert variants
      db.run(sql`
        INSERT INTO benchmark_variants (id, benchmark_id, tenant_id, name, tag, sort_order)
        VALUES ('var-1', 'bench-1', 'tenant-1', 'Variant A', 'tag-a', 0)
      `);
      db.run(sql`
        INSERT INTO benchmark_variants (id, benchmark_id, tenant_id, name, tag, sort_order)
        VALUES ('var-2', 'bench-1', 'tenant-1', 'Variant B', 'tag-b', 1)
      `);

      // Verify variants exist
      const variantsBefore = db.all<{ id: string }>(
        sql`SELECT id FROM benchmark_variants WHERE benchmark_id = 'bench-1'`,
      );
      expect(variantsBefore).toHaveLength(2);

      // Delete the benchmark
      db.run(sql`DELETE FROM benchmarks WHERE id = 'bench-1'`);

      // Verify variants are cascade deleted
      const variantsAfter = db.all<{ id: string }>(
        sql`SELECT id FROM benchmark_variants WHERE benchmark_id = 'bench-1'`,
      );
      expect(variantsAfter).toHaveLength(0);
    });

    it('should cascade delete results when benchmark is deleted', () => {
      // Insert a benchmark
      db.run(sql`
        INSERT INTO benchmarks (id, tenant_id, name, status, metrics, min_sessions_per_variant, created_at, updated_at)
        VALUES ('bench-2', 'tenant-1', 'Test Benchmark 2', 'completed', '["health_score"]', 10, '2026-02-08T12:00:00Z', '2026-02-08T12:00:00Z')
      `);

      // Insert results
      db.run(sql`
        INSERT INTO benchmark_results (id, benchmark_id, tenant_id, variant_metrics, comparisons, summary, computed_at)
        VALUES ('res-1', 'bench-2', 'tenant-1', '[]', '[]', 'Test summary', '2026-02-08T15:00:00Z')
      `);

      // Verify result exists
      const resultsBefore = db.all<{ id: string }>(
        sql`SELECT id FROM benchmark_results WHERE benchmark_id = 'bench-2'`,
      );
      expect(resultsBefore).toHaveLength(1);

      // Delete the benchmark
      db.run(sql`DELETE FROM benchmarks WHERE id = 'bench-2'`);

      // Verify results are cascade deleted
      const resultsAfter = db.all<{ id: string }>(
        sql`SELECT id FROM benchmark_results WHERE benchmark_id = 'bench-2'`,
      );
      expect(resultsAfter).toHaveLength(0);
    });
  });

  describe('migration idempotency', () => {
    it('should run migrations twice without error', () => {
      expect(() => runMigrations(db)).not.toThrow();
    });

    it('should not affect existing tables when re-run', () => {
      // Insert data before re-migration
      db.run(sql`
        INSERT INTO benchmarks (id, tenant_id, name, status, metrics, min_sessions_per_variant, created_at, updated_at)
        VALUES ('bench-idem', 'tenant-1', 'Idempotent', 'draft', '["avg_cost"]', 5, '2026-02-08T12:00:00Z', '2026-02-08T12:00:00Z')
      `);

      // Re-run migrations
      runMigrations(db);

      // Verify data survived
      const rows = db.all<{ id: string }>(
        sql`SELECT id FROM benchmarks WHERE id = 'bench-idem'`,
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('existing tables unaffected', () => {
    it('should still have events, sessions, agents tables', () => {
      const tables = db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`,
      );
      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('events');
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('agents');
      expect(tableNames).toContain('alert_rules');
      expect(tableNames).toContain('alert_history');
    });
  });
});
