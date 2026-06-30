/**
 * #256 — cloud project isolation (RLS). A project-scoped read sees only its own
 * project's rows within the org; an org-scoped read (no project) sees them all.
 * Runs against live Postgres via the #256 harness (gated on DATABASE_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../migrate.js';
import { withTenantTransaction } from '../tenant-pool.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

type Pool = import('../tenant-pool.js').Pool;

describeDb('#256: cloud project isolation (RLS)', () => {
  let pool: import('pg').Pool;
  const orgId = '00000000-0000-0000-0000-0000025600a1';
  const projA = '00000000-0000-0000-0000-0000025600a2';
  const projB = '00000000-0000-0000-0000-0000025600a3';

  const insertEvent = (project: string) => (c: { query: Function }) =>
    c.query(
      `INSERT INTO events (org_id, project_id, timestamp, session_id, agent_id, event_type, payload, hash)
       VALUES ($1, $2, now(), 's', 'a', 't', '{}', 'h')`,
      [orgId, project],
    );

  beforeAll(async () => {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    await runMigrations(pool);

    await withTenantTransaction(pool as unknown as Pool, orgId, async (c) => {
      await c.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, 'iso', 'iso-256') ON CONFLICT (id) DO NOTHING`, [orgId]);
    });
    await withTenantTransaction(pool as unknown as Pool, orgId, insertEvent(projA), projA);
    await withTenantTransaction(pool as unknown as Pool, orgId, insertEvent(projB), projB);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('a project-scoped read sees only that project\'s events', async () => {
    const a = await withTenantTransaction(pool as unknown as Pool, orgId, (c) => c.query('SELECT project_id FROM events'), projA);
    expect(a.rows.length).toBe(1);
    expect((a.rows[0] as { project_id: string }).project_id).toBe(projA);

    const b = await withTenantTransaction(pool as unknown as Pool, orgId, (c) => c.query('SELECT project_id FROM events'), projB);
    expect(b.rows.length).toBe(1);
    expect((b.rows[0] as { project_id: string }).project_id).toBe(projB);
  });

  it('an org-scoped read (no project) sees every project in the org', async () => {
    const all = await withTenantTransaction(pool as unknown as Pool, orgId, (c) => c.query('SELECT project_id FROM events'));
    expect(all.rows.length).toBe(2);
  });
});
