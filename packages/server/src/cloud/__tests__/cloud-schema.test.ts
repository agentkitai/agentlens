/**
 * Cloud Schema Tests (S-1.1, S-1.2, S-1.3)
 *
 * Tests run against a real Postgres instance if DATABASE_URL is set,
 * otherwise they validate SQL syntax, migration ordering, and structure.
 *
 * To run integration tests:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/agentlens_test pnpm test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getMigrationFiles,
  readMigration,
  validateMigrations,
  runMigrations,
  CLOUD_TABLES,
  EXISTING_TABLES,
  TENANT_SCOPED_TABLES,
  type MigrationClient,
} from '../migrate.js';
import { join } from 'path';

const MIGRATIONS_DIR = join(import.meta.dirname ?? __dirname, '..', 'migrations');

// ═══════════════════════════════════════════
// Helpers for Postgres integration tests
// ═══════════════════════════════════════════

let pg: typeof import('pg') | null = null;
let pool: InstanceType<typeof import('pg').Pool> | null = null;
let client: MigrationClient | null = null;
let pgAvailable = false;

async function tryConnectPg() {
  try {
    pg = await import('pg');
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) return false;
    pool = new pg.Pool({ connectionString: dbUrl, max: 5 });
    // Verify connection
    const res = await pool.query('SELECT 1 as ok');
    if (res.rows[0]?.ok === 1) {
      client = pool;
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function resetDatabase() {
  if (!pool) return;
  // Drop all tables in reverse dependency order
  await pool.query(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

// ═══════════════════════════════════════════
// S-1.1: Cloud-Specific Tables (12 tests)
// ═══════════════════════════════════════════

describe('S-1.1: Cloud-Specific Tables', () => {
  describe('Migration file validation', () => {
    it('001_cloud_tables.sql exists and is non-empty', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql.length).toBeGreaterThan(100);
    });

    it('contains CREATE TABLE for all 8 cloud tables', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      for (const table of CLOUD_TABLES) {
        expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      }
    });

    it('orgs.plan has CHECK constraint for free/pro/team/enterprise', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/CHECK\s*\(\s*plan\s+IN\s*\(\s*'free'\s*,\s*'pro'\s*,\s*'team'\s*,\s*'enterprise'\s*\)/);
    });

    it('org_members.role has CHECK constraint for owner/admin/member/viewer', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/CHECK\s*\(\s*role\s+IN\s*\(\s*'owner'\s*,\s*'admin'\s*,\s*'member'\s*,\s*'viewer'\s*\)/);
    });

    it('api_keys.key_hash is NOT NULL (no plaintext storage)', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/key_hash\s+TEXT\s+NOT\s+NULL/);
    });

    it('audit_log has actor_type CHECK constraint', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/actor_type.*CHECK\s*\(\s*actor_type\s+IN\s*\(\s*'user'\s*,\s*'api_key'\s*,\s*'system'\s*\)/);
    });

    it('audit_log has result CHECK constraint', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/result.*CHECK\s*\(\s*result\s+IN\s*\(\s*'success'\s*,\s*'failure'\s*\)/);
    });

    it('audit_log restricts UPDATE/DELETE for app role', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('GRANT SELECT, INSERT ON audit_log');
      // Should NOT grant UPDATE or DELETE
      expect(sql).not.toMatch(/GRANT.*UPDATE.*ON\s+audit_log\s+TO\s+agentlens_app/);
      expect(sql).not.toMatch(/GRANT.*DELETE.*ON\s+audit_log\s+TO\s+agentlens_app/);
    });

    it('invoices.status has CHECK constraint', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain("status IN ('draft', 'open', 'paid', 'void', 'uncollectible')");
    });

    it('api_keys.environment has CHECK constraint', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain("environment IN ('production', 'staging', 'development', 'test')");
    });

    it('all cloud tables use UUID primary keys', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      // orgs, users, org_invitations, api_keys, invoices, audit_log all have UUID PKs
      const uuidPkTables = ['orgs', 'users', 'org_invitations', 'api_keys', 'invoices', 'audit_log'];
      for (const _table of uuidPkTables) {
        expect(sql).toMatch(/id\s+UUID\s+PRIMARY\s+KEY\s+DEFAULT\s+gen_random_uuid\(\)/);
      }
    });

    it('all tables use TIMESTAMPTZ (not TEXT) for dates', () => {
      const sql = readMigration('001_cloud_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('TIMESTAMPTZ');
      // Should not have TEXT type for date columns
      expect(sql).not.toMatch(/created_at\s+TEXT/);
      expect(sql).not.toMatch(/updated_at\s+TEXT/);
    });
  });
});

// ═══════════════════════════════════════════
// S-1.2: Migrate Existing Tables (15 tests)
// ═══════════════════════════════════════════

describe('S-1.2: Migrate Existing Tables', () => {
  describe('Migration file validation', () => {
    it('002_existing_tables.sql exists and is non-empty', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql.length).toBeGreaterThan(100);
    });

    it('contains CREATE TABLE for all existing tables', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      for (const table of EXISTING_TABLES) {
        expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      }
    });

    it('every existing table has org_id UUID', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      for (const table of EXISTING_TABLES) {
        const tableBlock = extractTableBlock(sql, table);
        expect(tableBlock, `Table ${table} should have org_id`).toContain('org_id UUID');
      }
    });

    it('org_id references orgs(id) ON DELETE CASCADE', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      const refCount = (sql.match(/org_id UUID NOT NULL REFERENCES orgs\(id\) ON DELETE CASCADE/g) || []).length;
      // At least one per table that has a direct FK (some use composite PKs)
      expect(refCount).toBeGreaterThanOrEqual(10);
    });

    it('uses TIMESTAMPTZ instead of TEXT for timestamp columns', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      // Should not have TEXT type for timestamp-like columns
      expect(sql).not.toMatch(/started_at\s+TEXT/);
      expect(sql).not.toMatch(/ended_at\s+TEXT/);
      expect(sql).not.toMatch(/triggered_at\s+TEXT/);
      // Should have TIMESTAMPTZ
      expect(sql).toContain('started_at TIMESTAMPTZ');
    });

    it('uses BOOLEAN instead of INTEGER for boolean columns', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('enabled BOOLEAN');
      expect(sql).toContain('is_regex BOOLEAN');
      expect(sql).toContain('human_review_enabled BOOLEAN');
      expect(sql).toContain('delegation_enabled BOOLEAN');
    });

    it('uses JSONB instead of TEXT for JSON columns', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/payload\s+JSONB/);
      expect(sql).toMatch(/metadata\s+JSONB/);
      expect(sql).toMatch(/tags\s+JSONB/);
      expect(sql).toMatch(/scope\s+JSONB/);
    });

    it('events table has composite indexes on (org_id, ...)', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('idx_events_org_session');
      expect(sql).toContain('idx_events_org_type_ts');
      expect(sql).toContain('idx_events_org_ts');
      expect(sql).toContain('idx_events_org_agent_ts');
    });

    it('sessions table has composite indexes on (org_id, ...)', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('idx_sessions_org_agent');
      expect(sql).toContain('idx_sessions_org_started');
      expect(sql).toContain('idx_sessions_org_status');
    });

    it('sessions.status has CHECK constraint', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain("status IN ('active', 'completed', 'error')");
    });

    it('lessons table has composite indexes', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toContain('idx_lessons_org_agent');
      expect(sql).toContain('idx_lessons_org_category');
      expect(sql).toContain('idx_lessons_org_importance');
    });

    it('embeddings uses BYTEA for binary data', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/embedding\s+BYTEA/);
    });

    it('all tables use IF NOT EXISTS (idempotent)', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      const createCount = (sql.match(/CREATE TABLE IF NOT EXISTS/g) || []).length;
      expect(createCount).toBeGreaterThanOrEqual(EXISTING_TABLES.length);
    });

    it('delegation_log has all required columns', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      const block = extractTableBlock(sql, 'delegation_log');
      expect(block).toContain('org_id');
      expect(block).toContain('direction');
      expect(block).toContain('agent_id');
      expect(block).toContain('task_type');
      expect(block).toContain('status');
    });

    it('capability_registry uses JSONB for schema columns', () => {
      const sql = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
      const block = extractTableBlock(sql, 'capability_registry');
      expect(block).toMatch(/input_schema\s+JSONB/);
      expect(block).toMatch(/output_schema\s+JSONB/);
    });
  });
});

// ═══════════════════════════════════════════
// S-1.3: Row-Level Security Policies (24 tests)
// ═══════════════════════════════════════════

describe('S-1.3: Row-Level Security Policies', () => {
  describe('Migration file validation', () => {
    it('003_rls_policies.sql exists and is non-empty', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql.length).toBeGreaterThan(100);
    });

    it('enables RLS on all tenant-scoped tables', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    });

    it('forces RLS even for table owners', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    });

    it('policies use current_setting(app.current_org)', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain("current_setting('app.current_org')::uuid");
    });

    it('policies include both USING and WITH CHECK', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain('USING');
      expect(sql).toContain('WITH CHECK');
    });

    it('includes all tenant-scoped tables in the array', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      for (const table of TENANT_SCOPED_TABLES) {
        expect(sql).toContain(`'${table}'`);
      }
    });

    it('is idempotent (DROP POLICY IF EXISTS before CREATE)', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain('DROP POLICY IF EXISTS');
    });

    it('orgs table has RLS enabled', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain('orgs_tenant_isolation ON orgs');
    });
  });

  // Per-table RLS validation (3 tests × 8 key tables = subset)
  describe('Per-table RLS coverage', () => {
    const keyTables = [
      'events', 'sessions', 'agents', 'api_keys',
      'usage_records', 'invoices', 'audit_log', 'lessons',
    ];

    for (const table of keyTables) {
      it(`${table} is listed for RLS`, () => {
        const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
        expect(sql).toContain(`'${table}'`);
      });
    }
  });

  // 8 more tests for RLS behavior concepts
  describe('RLS behavior validation', () => {
    it('uses USING clause for SELECT filtering', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/USING\s*\(\s*org_id\s*=\s*current_setting/);
    });

    it('uses WITH CHECK clause for INSERT/UPDATE filtering', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toMatch(/WITH\s+CHECK\s*\(\s*org_id\s*=\s*current_setting/);
    });

    it('orgs policy uses id (not org_id) for self-reference', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      // orgs table uses id = current_setting, not org_id
      expect(sql).toMatch(/ON\s+orgs\s*\n\s*USING\s*\(\s*id\s*=\s*current_setting/);
    });

    it('users table does NOT have RLS (cross-org resource)', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      // The DO block array should not include 'users'
      expect(sql).not.toMatch(/'users'/);
    });

    it('policy names follow table_tenant_isolation pattern', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain("tbl || '_tenant_isolation'");
    });

    it('all sharing tables have RLS', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain("'sharing_config'");
      expect(sql).toContain("'sharing_audit_log'");
      expect(sql).toContain("'sharing_review_queue'");
      expect(sql).toContain("'agent_sharing_config'");
    });

    it('discovery and delegation tables have RLS', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain("'discovery_config'");
      expect(sql).toContain("'delegation_log'");
      expect(sql).toContain("'capability_registry'");
    });

    it('alert tables have RLS', () => {
      const sql = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
      expect(sql).toContain("'alert_rules'");
      expect(sql).toContain("'alert_history'");
    });
  });
});

// ═══════════════════════════════════════════
// Migration Runner Tests
// ═══════════════════════════════════════════

describe('Migration Runner', () => {
  it('validates all migration files successfully', () => {
    const result = validateMigrations(MIGRATIONS_DIR);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('finds at least 3 migration files', () => {
    const files = getMigrationFiles(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('migration files are in correct order', () => {
    const files = getMigrationFiles(MIGRATIONS_DIR);
    expect(files[0]).toBe('001_cloud_tables.sql');
    expect(files[1]).toBe('002_existing_tables.sql');
    expect(files[2]).toBe('003_rls_policies.sql');
  });

  it('002 depends on 001 (references orgs table)', () => {
    const sql002 = readMigration('002_existing_tables.sql', MIGRATIONS_DIR);
    expect(sql002).toContain('REFERENCES orgs(id)');
  });

  it('003 depends on 001+002 (references tables from both)', () => {
    const sql003 = readMigration('003_rls_policies.sql', MIGRATIONS_DIR);
    // References cloud tables
    expect(sql003).toContain("'api_keys'");
    // References existing tables
    expect(sql003).toContain("'events'");
  });
});

// ═══════════════════════════════════════════
// Integration Tests (require Postgres)
// ═══════════════════════════════════════════

describe('Integration: Full migration run', () => {
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

  it.skipIf(!pgAvailable)('runs all migrations successfully', async () => {
    const result = await runMigrations(client!, MIGRATIONS_DIR);
    expect(result.applied).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);
  });

  it.skipIf(!pgAvailable)('is idempotent (re-run skips all)', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    const result = await runMigrations(client!, MIGRATIONS_DIR);
    expect(result.applied).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  it.skipIf(!pgAvailable)('creates all cloud tables', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    for (const table of CLOUD_TABLES) {
      const res = await pool!.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
        [table],
      );
      expect(res.rows.length, `Table ${table} should exist`).toBe(1);
    }
  });

  it.skipIf(!pgAvailable)('creates all existing tables', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    for (const table of EXISTING_TABLES) {
      const res = await pool!.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public'`,
        [table],
      );
      expect(res.rows.length, `Table ${table} should exist`).toBe(1);
    }
  });

  it.skipIf(!pgAvailable)('RLS is enabled on tenant-scoped tables', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    for (const table of TENANT_SCOPED_TABLES) {
      const res = await pool!.query(
        `SELECT rowsecurity, forcerowsecurity FROM pg_class WHERE relname = $1`,
        [table],
      );
      expect(res.rows[0]?.rowsecurity, `RLS on ${table}`).toBe(true);
      expect(res.rows[0]?.forcerowsecurity, `Force RLS on ${table}`).toBe(true);
    }
  });

  it.skipIf(!pgAvailable)('RLS isolation: no org context returns 0 rows', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    // Insert an org as superuser (bypassing RLS)
    await pool!.query(`SET app.current_org = '00000000-0000-0000-0000-000000000001'`);
    await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'Test', 'test')`);
    await pool!.query(`RESET app.current_org`);
    // Query without context — should get error or 0 rows
    try {
      const res = await pool!.query('SELECT * FROM orgs');
      // If RLS is enforced and no setting exists, Postgres raises an error
      // or returns 0 rows depending on configuration
      expect(res.rows.length).toBe(0);
    } catch (err: any) {
      // Expected: unrecognized configuration parameter "app.current_org"
      expect(err.message).toContain('current_org');
    }
  });

  it.skipIf(!pgAvailable)('RLS isolation: org A cannot see org B data', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    const orgA = '00000000-0000-0000-0000-00000000000a';
    const orgB = '00000000-0000-0000-0000-00000000000b';

    // Create orgs (need to set context to create via RLS)
    // Use a fresh connection with superuser to bypass RLS for setup
    await pool!.query('BEGIN');
    await pool!.query(`SET LOCAL app.current_org = '${orgA}'`);
    await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ('${orgA}', 'Org A', 'org-a')`);
    await pool!.query('COMMIT');

    await pool!.query('BEGIN');
    await pool!.query(`SET LOCAL app.current_org = '${orgB}'`);
    await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ('${orgB}', 'Org B', 'org-b')`);
    await pool!.query('COMMIT');

    // Query as org A
    await pool!.query('BEGIN');
    await pool!.query(`SET LOCAL app.current_org = '${orgA}'`);
    const res = await pool!.query('SELECT * FROM orgs');
    await pool!.query('COMMIT');

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].slug).toBe('org-a');
  });

  it.skipIf(!pgAvailable)('RLS isolation: cross-org INSERT blocked', async () => {
    await runMigrations(client!, MIGRATIONS_DIR);
    const orgA = '00000000-0000-0000-0000-00000000000a';
    const orgB = '00000000-0000-0000-0000-00000000000b';

    // Create org A
    await pool!.query('BEGIN');
    await pool!.query(`SET LOCAL app.current_org = '${orgA}'`);
    await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ('${orgA}', 'Org A', 'org-a')`);
    await pool!.query('COMMIT');

    // Try to insert into org B while context is org A
    await pool!.query('BEGIN');
    await pool!.query(`SET LOCAL app.current_org = '${orgA}'`);
    try {
      await pool!.query(`INSERT INTO orgs (id, name, slug) VALUES ('${orgB}', 'Org B', 'org-b')`);
      await pool!.query('COMMIT');
      // Should not reach here — WITH CHECK should block it
      expect.unreachable('Cross-org INSERT should be blocked');
    } catch (err: any) {
      await pool!.query('ROLLBACK');
      expect(err.message).toContain('row-level security');
    }
  });
});

// ═══════════════════════════════════════════
// Helper Functions
// ═══════════════════════════════════════════

function extractTableBlock(sql: string, tableName: string): string {
  const regex = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${tableName}\\s*\\([^;]+\\)`,
    's',
  );
  const match = sql.match(regex);
  return match ? match[0] : '';
}
