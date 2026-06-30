/**
 * #256 — cloud project isolation (RLS). A project-scoped read sees only its own
 * project's rows within the org; an org-scoped read (no project) sees them all.
 * Runs against live Postgres via the #256 harness (gated on DATABASE_URL).
 *
 * NOTE: the queries run under a non-superuser role (rls_tester). Postgres
 * superusers — which the test connection is — BYPASS row-level security entirely,
 * so RLS can only be validated as a non-superuser. Setup inserts run as the
 * superuser (RLS bypassed) on purpose; only the reads switch role.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runMigrations } from '../migrate.js';

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb('#256: cloud project isolation (RLS)', () => {
  let pool: import('pg').Pool;
  const orgId = '00000000-0000-0000-0000-0000025600a1';
  const projA = '00000000-0000-0000-0000-0000025600a2';
  const projB = '00000000-0000-0000-0000-0000025600a3';

  /** Read events under the non-superuser role, optionally project-scoped. */
  async function readProjects(project: string | null): Promise<string[]> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
      if (project) await c.query(`SELECT set_config('app.current_project', $1, true)`, [project]);
      await c.query('SET LOCAL ROLE rls_tester');
      const res = await c.query('SELECT project_id FROM events ORDER BY project_id');
      await c.query('COMMIT');
      return (res.rows as { project_id: string }[]).map((r) => r.project_id);
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    const pg = await import('pg');
    pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    await runMigrations(pool);

    // A non-superuser role so RLS is actually enforced for the reads.
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rls_tester') THEN CREATE ROLE rls_tester NOLOGIN; END IF;
    END $$;`);
    await pool.query('GRANT USAGE ON SCHEMA public TO rls_tester');
    await pool.query('GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO rls_tester');

    // Setup runs as the superuser (RLS bypassed): one org, two events in
    // different projects.
    await pool.query(`INSERT INTO orgs (id, name, slug) VALUES ($1, 'iso', 'iso-256') ON CONFLICT (id) DO NOTHING`, [orgId]);
    for (const project of [projA, projB]) {
      await pool.query(
        `INSERT INTO events (org_id, project_id, timestamp, session_id, agent_id, event_type, payload, hash)
         VALUES ($1, $2, now(), 's', 'a', 't', '{}', 'h')`,
        [orgId, project],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('a project-scoped read sees only that project\'s events', async () => {
    expect(await readProjects(projA)).toEqual([projA]);
    expect(await readProjects(projB)).toEqual([projB]);
  });

  it('an org-scoped read (no project) sees every project in the org', async () => {
    expect(await readProjects(null)).toEqual([projA, projB]);
  });
});
