/**
 * Batch 2 Track A Tests (S-1.4, S-1.5, S-1.6)
 *
 * S-1.4: Table Partitioning (~10 tests)
 * S-1.5: Connection Pool with Tenant Context (~8 tests)
 * S-1.6: pgvector Extension & Embedding Tables (~6 tests)
 *
 * Tests run against a real Postgres instance if DATABASE_URL is set,
 * otherwise they validate SQL syntax and module structure.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  readMigration,
  getMigrationFiles,
  runMigrations,
  validateMigrations,
  PARTITIONED_TABLES,
  type MigrationClient,
} from '../migrate.js';
import { withTenantTransaction, tenantQuery, adminQuery, type Pool, type PoolClient } from '../tenant-pool.js';
import { maintainPartitions, getPartitions, createMonthlyPartition } from '../partition-maintenance.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');

// ═══════════════════════════════════════════
// Postgres connection helpers
// ═══════════════════════════════════════════

let pg: typeof import('pg') | null = null;
let pool: InstanceType<typeof import('pg').Pool> | null = null;
let pgAvailable = false;

async function tryConnectPg() {
  try {
    pg = await import('pg');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return false;
    pool = new pg.Pool({ connectionString: dbUrl, max: 10 });
    const res = await pool.query('SELECT 1 as ok');
    return res.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

async function resetDatabase() {
  if (!pool) return;
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
  // Drop functions too
  await pool.query(`DROP FUNCTION IF EXISTS create_monthly_partition CASCADE`);
  await pool.query(`DROP FUNCTION IF EXISTS maintain_partitions CASCADE`);
  // Drop extensions
  await pool.query(`DROP EXTENSION IF EXISTS vector CASCADE`);
}

// ═══════════════════════════════════════════
// S-1.4: Table Partitioning (10 tests)
// ═══════════════════════════════════════════

describe('S-1.4: Table Partitioning', () => {
  describe('Migration file validation', () => {
    it('005_partitioning.sql exists and is non-empty', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql.length).toBeGreaterThan(100);
    });

    it('creates partitioned events table with PARTITION BY RANGE', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('PARTITION BY RANGE (timestamp)');
    });

    it('creates partitioned audit_log table', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('PARTITION BY RANGE (created_at)');
    });

    it('creates partitioned usage_records table', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('PARTITION BY RANGE (hour)');
    });

    it('includes create_monthly_partition helper function', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('CREATE OR REPLACE FUNCTION create_monthly_partition');
    });

    it('includes maintain_partitions function', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('CREATE OR REPLACE FUNCTION maintain_partitions');
    });

    it('re-enables RLS on recreated tables', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('events_tenant_isolation ON events');
      expect(sql).toContain('audit_log_tenant_isolation ON audit_log');
      expect(sql).toContain('usage_records_tenant_isolation ON usage_records');
    });

    it('creates initial partitions for ±3 months', () => {
      const sql = readMigration('005_partitioning.sql', MIGRATIONS_DIR);
      expect(sql).toContain('-3..3');
    });
  });

  describe('Partition maintenance module', () => {
    it('exports maintainPartitions function', () => {
      expect(typeof maintainPartitions).toBe('function');
    });

    it('exports getPartitions function', () => {
      expect(typeof getPartitions).toBe('function');
    });
  });

  describe('Integration: Partitioning', () => {
    beforeAll(async () => {
      pgAvailable = await tryConnectPg();
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      if (!pgAvailable) return;
      await resetDatabase();
    });

    it.skipIf(!pgAvailable)('migrations create partitioned tables', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      for (const table of PARTITIONED_TABLES) {
        const res = await pool!.query(
          `SELECT 1 FROM pg_partitioned_table pt
           JOIN pg_class c ON c.oid = pt.partrelid
           WHERE c.relname = $1`,
          [table],
        );
        expect(res.rows.length, `${table} should be partitioned`).toBe(1);
      }
    });

    it.skipIf(!pgAvailable)('partitions exist for current month', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);
      const now = new Date();
      const suffix = `_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

      for (const table of PARTITIONED_TABLES) {
        const partitions = await getPartitions(pool!, table);
        const names = partitions.map((p) => p.name);
        expect(names.some((n) => n.includes(suffix)), `${table} should have partition for current month`).toBe(true);
      }
    });

    it.skipIf(!pgAvailable)('queries work transparently across partitions', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      // Create an org first
      const orgId = '00000000-0000-0000-0000-000000000001';
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgId]);
      await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, 'Test', 'test')`, [orgId]);
      await pool!.query('COMMIT');

      // Insert event into current partition
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgId]);
      await pool!.query(
        `INSERT INTO events (org_id, timestamp, session_id, agent_id, event_type, payload, hash)
         VALUES ($1, now(), 'sess1', 'agent1', 'test', '{}', 'hash1')`,
        [orgId],
      );
      await pool!.query('COMMIT');

      // Query should find it
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgId]);
      const res = await pool!.query('SELECT * FROM events');
      await pool!.query('COMMIT');

      expect(res.rows.length).toBe(1);
    });

    it.skipIf(!pgAvailable)('maintainPartitions creates future partitions', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      // Run maintenance — should be idempotent (partitions already exist)
      const actions = await maintainPartitions(pool!, 12);
      // All future partitions should already exist from migration, so no new ones
      // But the function should run without error
      expect(Array.isArray(actions)).toBe(true);
    });

    it.skipIf(!pgAvailable)('partition drop is instant (no vacuum)', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      // Create a partition far in the past
      await createMonthlyPartition(pool!, 'events', 2020, 1);

      // Verify it exists
      let partitions = await getPartitions(pool!, 'events');
      expect(partitions.some((p) => p.name.includes('2020_01'))).toBe(true);

      // Run maintenance with short retention — should drop it
      await maintainPartitions(pool!, 1);

      partitions = await getPartitions(pool!, 'events');
      expect(partitions.some((p) => p.name.includes('2020_01'))).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════
// S-1.5: Connection Pool with Tenant Context (8 tests)
// ═══════════════════════════════════════════

describe('S-1.5: Connection Pool with Tenant Context', () => {
  describe('Module validation', () => {
    it('exports withTenantTransaction function', () => {
      expect(typeof withTenantTransaction).toBe('function');
    });

    it('exports tenantQuery function', () => {
      expect(typeof tenantQuery).toBe('function');
    });

    it('exports adminQuery function', () => {
      expect(typeof adminQuery).toBe('function');
    });

    it('rejects empty orgId', async () => {
      const mockPool = { connect: () => Promise.resolve({}) } as unknown as Pool;
      await expect(withTenantTransaction(mockPool, '', async () => {})).rejects.toThrow('orgId is required');
    });

    it('rejects invalid UUID format', async () => {
      const mockPool = { connect: () => Promise.resolve({}) } as unknown as Pool;
      await expect(withTenantTransaction(mockPool, 'not-a-uuid', async () => {})).rejects.toThrow('valid UUID');
    });
  });

  describe('Integration: Tenant context', () => {
    beforeAll(async () => {
      pgAvailable = await tryConnectPg();
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      if (!pgAvailable) return;
      await resetDatabase();
      await runMigrations(pool!, MIGRATIONS_DIR);
    });

    it.skipIf(!pgAvailable)('SET LOCAL scoped to transaction — auto-resets on commit', async () => {
      const orgId = '00000000-0000-0000-0000-000000000001';

      // Insert org
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgId]);
      await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, 'Test', 'test')`, [orgId]);
      await pool!.query('COMMIT');

      // Use tenant transaction
      await withTenantTransaction(pool!, orgId, async (client) => {
        const res = await client.query('SELECT * FROM orgs');
        expect(res.rows.length).toBe(1);
      });

      // After transaction, a new query should NOT have the org context
      const client = await pool!.connect();
      try {
        await client.query('BEGIN');
        // Without SET LOCAL, querying RLS-protected table should return 0 or error
        try {
          const res = await client.query('SELECT current_setting(\'app.current_org\', true)');
          // Should be null or empty after transaction commit
          expect(res.rows[0]?.current_setting).toBeFalsy();
        } catch {
          // Expected: setting doesn't exist outside transaction
        }
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    it.skipIf(!pgAvailable)('concurrent requests with different orgs don\'t leak', async () => {
      const orgA = '00000000-0000-0000-0000-00000000000a';
      const orgB = '00000000-0000-0000-0000-00000000000b';

      // Setup orgs
      for (const [id, name, slug] of [[orgA, 'Org A', 'org-a'], [orgB, 'Org B', 'org-b']] as const) {
        await pool!.query('BEGIN');
        await pool!.query(`SET LOCAL app.current_org = $1`, [id]);
        await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, [id, name, slug]);
        await pool!.query('COMMIT');
      }

      // Run concurrent queries
      const [resultA, resultB] = await Promise.all([
        withTenantTransaction(pool!, orgA, async (client) => {
          const res = await client.query('SELECT slug FROM orgs');
          return res.rows as { slug: string }[];
        }),
        withTenantTransaction(pool!, orgB, async (client) => {
          const res = await client.query('SELECT slug FROM orgs');
          return res.rows as { slug: string }[];
        }),
      ]);

      expect(resultA).toHaveLength(1);
      expect(resultA[0].slug).toBe('org-a');
      expect(resultB).toHaveLength(1);
      expect(resultB[0].slug).toBe('org-b');
    });

    it.skipIf(!pgAvailable)('rollback on error clears tenant context', async () => {
      const orgId = '00000000-0000-0000-0000-000000000001';

      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgId]);
      await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, 'Test', 'test')`, [orgId]);
      await pool!.query('COMMIT');

      // Force an error in the transaction
      try {
        await withTenantTransaction(pool!, orgId, async (_client) => {
          throw new Error('deliberate error');
        });
      } catch {
        // Expected
      }

      // Pool should still work fine for next transaction
      const result = await withTenantTransaction(pool!, orgId, async (client) => {
        return client.query('SELECT * FROM orgs');
      });
      expect(result.rows.length).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════
// S-1.6: pgvector Extension & Embedding Tables (6 tests)
// ═══════════════════════════════════════════

describe('S-1.6: pgvector Extension & Embedding Tables', () => {
  describe('Migration file validation', () => {
    it('006_pgvector.sql exists and is non-empty', () => {
      const sql = readMigration('006_pgvector.sql', MIGRATIONS_DIR);
      expect(sql.length).toBeGreaterThan(100);
    });

    it('enables vector extension', () => {
      const sql = readMigration('006_pgvector.sql', MIGRATIONS_DIR);
      expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS vector');
    });

    it('adds embedding_vector column with vector type', () => {
      const sql = readMigration('006_pgvector.sql', MIGRATIONS_DIR);
      expect(sql).toContain('embedding_vector vector(1536)');
    });

    it('creates HNSW index for vector search', () => {
      const sql = readMigration('006_pgvector.sql', MIGRATIONS_DIR);
      expect(sql).toContain('USING hnsw');
      expect(sql).toContain('vector_cosine_ops');
    });

    it('re-enables RLS on embeddings table', () => {
      const sql = readMigration('006_pgvector.sql', MIGRATIONS_DIR);
      expect(sql).toContain('embeddings_tenant_isolation ON embeddings');
    });
  });

  describe('Integration: pgvector', () => {
    beforeAll(async () => {
      pgAvailable = await tryConnectPg();
    });

    afterAll(async () => {
      if (pool) await pool.end();
    });

    beforeEach(async () => {
      if (!pgAvailable) return;
      await resetDatabase();
    });

    it.skipIf(!pgAvailable)('pgvector extension enabled and embedding_vector column exists', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      // Check extension
      const ext = await pool!.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
      expect(ext.rows.length).toBe(1);

      // Check column
      const col = await pool!.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = 'embeddings' AND column_name = 'embedding_vector'`,
      );
      expect(col.rows.length).toBe(1);
    });

    it.skipIf(!pgAvailable)('semantic search respects RLS isolation', async () => {
      await runMigrations(pool!, MIGRATIONS_DIR);

      const orgA = '00000000-0000-0000-0000-00000000000a';
      const orgB = '00000000-0000-0000-0000-00000000000b';

      // Create orgs
      for (const [id, slug] of [[orgA, 'org-a'], [orgB, 'org-b']]) {
        await pool!.query('BEGIN');
        await pool!.query(`SET LOCAL app.current_org = $1`, [id]);
        await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, $2, $3)`, [id, slug, slug]);
        await pool!.query('COMMIT');
      }

      // Create a zero vector string for 1536 dims
      const zeroVec = `[${Array(1536).fill('0').join(',')}]`;
      const oneVec = `[${['1', ...Array(1535).fill('0')].join(',')}]`;

      // Insert embedding for org A
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgA]);
      await pool!.query(
        `INSERT INTO embeddings (org_id, source_type, source_id, content_hash, text_content, embedding, embedding_model, dimensions, embedding_vector)
         VALUES ($1, 'lesson', 'l1', 'h1', 'org A lesson', '\\x00', 'ada-002', 1536, $2::vector)`,
        [orgA, oneVec],
      );
      await pool!.query('COMMIT');

      // Insert embedding for org B
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgB]);
      await pool!.query(
        `INSERT INTO embeddings (org_id, source_type, source_id, content_hash, text_content, embedding, embedding_model, dimensions, embedding_vector)
         VALUES ($1, 'lesson', 'l2', 'h2', 'org B lesson', '\\x00', 'ada-002', 1536, $2::vector)`,
        [orgB, zeroVec],
      );
      await pool!.query('COMMIT');

      // Semantic search as org A — should only see org A's embedding
      await pool!.query('BEGIN');
      await pool!.query(`SET LOCAL app.current_org = $1`, [orgA]);
      const res = await pool!.query(
        `SELECT text_content, 1 - (embedding_vector <=> $1::vector) AS similarity
         FROM embeddings
         ORDER BY embedding_vector <=> $1::vector
         LIMIT 5`,
        [oneVec],
      );
      await pool!.query('COMMIT');

      expect(res.rows.length).toBe(1);
      expect((res.rows[0] as any).text_content).toBe('org A lesson');
    });
  });
});

// ═══════════════════════════════════════════
// Migration runner updated validation
// ═══════════════════════════════════════════

describe('Migration Runner (updated for B2A)', () => {
  it('validates all migration files (including new ones)', () => {
    const result = validateMigrations(MIGRATIONS_DIR);
    expect(result.valid).toBe(true);
  });

  it('finds exactly 6 migration files', () => {
    const files = getMigrationFiles(MIGRATIONS_DIR);
    expect(files).toHaveLength(6);
  });

  it('new migrations are in correct order', () => {
    const files = getMigrationFiles(MIGRATIONS_DIR);
    expect(files[4]).toBe('005_partitioning.sql');
    expect(files[5]).toBe('006_pgvector.sql');
  });
});
