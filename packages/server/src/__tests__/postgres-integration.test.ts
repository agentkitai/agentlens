/**
 * Postgres integration tests — CRUD for core tables, tenant isolation, migrations.
 * Skipped when DB_DIALECT !== 'postgresql' (i.e. no Postgres available).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { resolve } from 'path';
import { randomUUID } from 'node:crypto';
import { OrgProjectStore } from '../db/org-project-store.js';
import { PromptStore } from '../db/prompt-store.js';
import { EvalStore } from '../db/eval-store.js';
import { EvaluatorStore } from '../db/evaluator-store.js';
import { BUILTIN_EVALUATORS } from '../lib/eval/builtin-evaluators.js';

const IS_PG = process.env.DB_DIALECT === 'postgresql';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/agentlens_test';

const describePg = IS_PG ? describe : describe.skip;

describePg('Postgres integration tests', () => {
  let pool: any;
  let db: any;
  let schema: typeof import('../db/schema.postgres.js');

  beforeAll(async () => {
    // Dynamic imports so tests skip cleanly when pg isn't installed
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    schema = await import('../db/schema.postgres.js');

    pool = new pg.default.Pool({ connectionString: DATABASE_URL });
    db = drizzle(pool, { schema });

    // Run migrations
    const migrationsFolder = resolve(__dirname, '../db/drizzle');
    await migrate(db, { migrationsFolder });
  });

  afterAll(async () => {
    await pool?.end();
  });

  // Clean tables before each test
  beforeEach(async () => {
    await db.delete(schema.events);
    await db.delete(schema.sessions);
    await db.delete(schema.agents);
    await db.delete(schema.apiKeys);
    await db.delete(schema.users);
  });

  // ─── CRUD: Events ─────────────────────────────────────
  describe('Events CRUD', () => {
    it('should insert and retrieve an event', async () => {
      const event = {
        id: 'evt-001',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'tool_call',
        severity: 'info',
        payload: { tool: 'search', args: {} },
        metadata: {},
        hash: 'abc123',
        tenantId: 'tenant-a',
      };

      await db.insert(schema.events).values(event);
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-001'));
      
      expect(rows).toHaveLength(1);
      expect(rows[0].sessionId).toBe('sess-001');
      expect(rows[0].eventType).toBe('tool_call');
    });

    it('should update an event', async () => {
      await db.insert(schema.events).values({
        id: 'evt-002',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'tool_call',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'hash1',
        tenantId: 'default',
      });

      await db.update(schema.events).set({ severity: 'error' }).where(eq(schema.events.id, 'evt-002'));
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-002'));
      expect(rows[0].severity).toBe('error');
    });

    it('should delete an event', async () => {
      await db.insert(schema.events).values({
        id: 'evt-003',
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'log',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'hash2',
        tenantId: 'default',
      });

      await db.delete(schema.events).where(eq(schema.events.id, 'evt-003'));
      const rows = await db.select().from(schema.events).where(eq(schema.events.id, 'evt-003'));
      expect(rows).toHaveLength(0);
    });
  });

  // ─── CRUD: Sessions ───────────────────────────────────
  describe('Sessions CRUD', () => {
    it('should insert and retrieve a session', async () => {
      await db.insert(schema.sessions).values({
        id: 'sess-001',
        agentId: 'agent-001',
        startedAt: new Date().toISOString(),
        status: 'active',
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, 'sess-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('active');
    });
  });

  // ─── CRUD: Agents ─────────────────────────────────────
  describe('Agents CRUD', () => {
    it('should insert and retrieve an agent', async () => {
      const now = new Date().toISOString();
      await db.insert(schema.agents).values({
        id: 'agent-001',
        name: 'TestAgent',
        firstSeenAt: now,
        lastSeenAt: now,
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, 'agent-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('TestAgent');
    });
  });

  // ─── CRUD: Users ──────────────────────────────────────
  describe('Users CRUD', () => {
    it('should insert and retrieve a user', async () => {
      const now = Math.floor(Date.now() / 1000);
      await db.insert(schema.users).values({
        id: 'user-001',
        tenantId: 'default',
        email: 'test@example.com',
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      });

      const rows = await db.select().from(schema.users).where(eq(schema.users.id, 'user-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe('test@example.com');
    });
  });

  // ─── CRUD: API Keys ──────────────────────────────────
  describe('API Keys CRUD', () => {
    it('should insert and retrieve an API key', async () => {
      const now = Math.floor(Date.now() / 1000);
      await db.insert(schema.apiKeys).values({
        id: 'key-001',
        keyHash: 'hash123',
        name: 'Test Key',
        scopes: ['read', 'write'],
        createdAt: now,
        tenantId: 'default',
      });

      const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, 'key-001'));
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Test Key');
    });
  });

  // ─── Tenant Isolation ─────────────────────────────────
  describe('Tenant isolation', () => {
    it('should isolate events by tenant', async () => {
      const base = {
        timestamp: new Date().toISOString(),
        sessionId: 'sess-001',
        agentId: 'agent-001',
        eventType: 'log',
        severity: 'info',
        payload: {},
        metadata: {},
        hash: 'h',
      };

      await db.insert(schema.events).values([
        { ...base, id: 'evt-a1', tenantId: 'tenant-a', hash: 'ha1' },
        { ...base, id: 'evt-a2', tenantId: 'tenant-a', hash: 'ha2' },
        { ...base, id: 'evt-b1', tenantId: 'tenant-b', hash: 'hb1' },
      ]);

      const tenantAEvents = await db.select().from(schema.events)
        .where(eq(schema.events.tenantId, 'tenant-a'));
      const tenantBEvents = await db.select().from(schema.events)
        .where(eq(schema.events.tenantId, 'tenant-b'));

      expect(tenantAEvents).toHaveLength(2);
      expect(tenantBEvents).toHaveLength(1);
    });

    it('should isolate sessions by tenant', async () => {
      await db.insert(schema.sessions).values([
        { id: 'sess-001', agentId: 'a1', startedAt: new Date().toISOString(), tenantId: 'tenant-a' },
        { id: 'sess-001', agentId: 'a1', startedAt: new Date().toISOString(), tenantId: 'tenant-b' },
      ]);

      const tenantA = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.tenantId, 'tenant-a'));
      const tenantB = await db.select().from(schema.sessions)
        .where(eq(schema.sessions.tenantId, 'tenant-b'));

      expect(tenantA).toHaveLength(1);
      expect(tenantB).toHaveLength(1);
    });

    it('should isolate agents by tenant', async () => {
      const now = new Date().toISOString();
      await db.insert(schema.agents).values([
        { id: 'agent-001', name: 'A', firstSeenAt: now, lastSeenAt: now, tenantId: 'tenant-a' },
        { id: 'agent-001', name: 'A', firstSeenAt: now, lastSeenAt: now, tenantId: 'tenant-b' },
      ]);

      const tenantA = await db.select().from(schema.agents)
        .where(eq(schema.agents.tenantId, 'tenant-a'));
      const tenantC = await db.select().from(schema.agents)
        .where(eq(schema.agents.tenantId, 'tenant-c'));

      expect(tenantA).toHaveLength(1);
      expect(tenantC).toHaveLength(0);
    });
  });

  // ─── Migration verification ───────────────────────────
  describe('Migration verification', () => {
    it('should have all expected tables', async () => {
      const result = await db.execute(sql`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `);

      const tableNames = result.rows.map((r: any) => r.table_name);
      
      const expectedTables = [
        'events', 'sessions', 'agents', 'alert_rules', 'alert_history',
        'users', 'api_keys', 'lessons', 'embeddings', 'session_summaries',
        // #172 feature 1: org/project model created on the pg path
        'orgs', 'projects', 'org_members', 'project_members',
        // #172 feature 2 (schema step): prompt-management tables on the pg path
        'prompt_templates', 'prompt_versions', 'prompt_fingerprints',
        'prompt_deployments', 'prompt_ab_tests',
        // #172 feature 3 (schema step): evaluation tables on the pg path
        'eval_datasets', 'eval_test_cases', 'eval_runs', 'eval_results',
        'evaluator_definitions',
      ];

      for (const table of expectedTables) {
        expect(tableNames, `Missing table: ${table}`).toContain(table);
      }
    });

    it('prompt tables accept the columns the store writes (incl. config/prompt_type)', async () => {
      // Smoke-test the 0008 schema: the dialect-agnostic PromptStore conversion
      // (next PR) relies on these exact columns existing on Postgres.
      const tpl = `tpl_${randomUUID()}`;
      const ver = `ver_${randomUUID()}`;
      await db.execute(sql`INSERT INTO prompt_templates (id, tenant_id, name, category, current_version_id, created_at, updated_at)
        VALUES (${tpl}, 'default', 'PG Tmpl', 'general', ${ver}, '2026-06-30T00:00:00Z', '2026-06-30T00:00:00Z')`);
      await db.execute(sql`INSERT INTO prompt_versions (id, template_id, tenant_id, version_number, content, config, prompt_type, content_hash, created_at)
        VALUES (${ver}, ${tpl}, 'default', 1, 'hello', '{}', 'chat', 'abc', '2026-06-30T00:00:00Z')`);
      const rows = await db.execute(sql`SELECT prompt_type FROM prompt_versions WHERE id = ${ver}`);
      expect(rows.rows[0].prompt_type).toBe('chat');
    });

    it('eval tables accept the store columns (float score, integer passed)', async () => {
      // Smoke-test the 0009 schema for the dialect-agnostic EvalStore (next PR).
      const ds = `ds_${randomUUID()}`;
      const run = `run_${randomUUID()}`;
      await db.execute(sql`INSERT INTO eval_datasets (id, tenant_id, name, version, immutable, created_at, updated_at)
        VALUES (${ds}, 'default', 'DS', 1, 0, '2026-06-30T00:00:00Z', '2026-06-30T00:00:00Z')`);
      await db.execute(sql`INSERT INTO eval_runs (id, tenant_id, dataset_id, dataset_version, agent_id, webhook_url, status, created_at)
        VALUES (${run}, 'default', ${ds}, 1, 'agt', 'https://x', 'pending', '2026-06-30T00:00:00Z')`);
      await db.execute(sql`INSERT INTO eval_results (id, run_id, test_case_id, tenant_id, score, passed, scorer_type, created_at)
        VALUES (${`res_${randomUUID()}`}, ${run}, 'tc1', 'default', 0.875, 1, 'exact_match', '2026-06-30T00:00:00Z')`);
      const r = await db.execute(sql`SELECT score, passed FROM eval_results WHERE run_id = ${run}`);
      expect(Number(r.rows[0].score)).toBeCloseTo(0.875, 6);
      expect(Number(r.rows[0].passed)).toBe(1);
    });
  });

  // ─── #172 feature 1: org/project model via the dialect-agnostic store ──
  describe('Org/project model (dialect-agnostic OrgProjectStore on Postgres)', () => {
    it('migration backfilled the default org + project', async () => {
      const store = new OrgProjectStore(db);
      expect((await store.getOrg('default'))?.slug).toBe('default');
      expect((await store.getProject('default'))?.orgId).toBe('default');
    });

    it('CRUDs orgs/projects/members and upserts membership via ON CONFLICT', async () => {
      const store = new OrgProjectStore(db);
      const org = await store.createOrg({ name: 'Acme PG', slug: `acme-${randomUUID().slice(0, 8)}` });
      expect((await store.listOrgs()).some((o) => o.id === org.id)).toBe(true);

      const proj = await store.createProject(org.id, { name: 'Web', slug: `web-${randomUUID().slice(0, 8)}` });
      expect((await store.listProjects(org.id)).map((p) => p.id)).toContain(proj.id);

      await store.addOrgMember(org.id, 'user-pg-1', 'owner');
      await store.addOrgMember(org.id, 'user-pg-1', 'admin'); // upsert, not duplicate
      const members = await store.listOrgMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe('admin');

      await store.addProjectMember(proj.id, 'user-pg-1', 'viewer');
      expect(await store.listProjectMembers(proj.id)).toHaveLength(1);
    });
  });

  // ─── #172 feature 2: prompt management via the dialect-agnostic store ──
  describe('Prompt management (dialect-agnostic PromptStore on Postgres)', () => {
    it('CRUDs templates/versions/fingerprints/deploys/AB and defers analytics on pg', async () => {
      const store = new PromptStore(db);
      const tid = `tenant-${randomUUID().slice(0, 8)}`;

      const { template, version } = await store.createTemplate(tid, { name: 'Greeting', content: 'Hello {{name}}', category: 'system' });
      expect(template.currentVersionId).toBe(version.id);
      expect((await store.getTemplate(template.id, tid))?.name).toBe('Greeting');

      const v2 = await store.createVersion(template.id, tid, { content: 'Hi {{name}}', promptType: 'chat' });
      expect(v2?.versionNumber).toBe(2);
      expect(await store.listVersions(template.id, tid)).toHaveLength(2);
      expect((await store.getVersion(v2!.id, tid))?.promptType).toBe('chat');

      // fingerprint upsert — ON CONFLICT increments call_count on both dialects
      await store.upsertFingerprint('h1', tid, 'agt1', 'sys', 1);
      await store.upsertFingerprint('h1', tid, 'agt1', 'sys', 2);
      const fps = await store.getFingerprints(tid);
      expect(fps).toHaveLength(1);
      expect(fps[0].callCount).toBe(3);

      // deploy ledger — server-authored hash chain, derived live version
      await store.appendDeployment(tid, { templateId: template.id, environment: 'staging', versionId: version.id, action: 'deploy' });
      expect(await store.getLiveVersion(tid, 'staging', template.id)).toBe(version.id);
      expect((await store.verifyDeployLedger(tid, 'staging')).valid).toBe(true);

      // A/B test
      const ab = await store.createAbTest(tid, template.id, 'staging', [{ versionId: version.id, label: 'a', weight: 1 }]);
      expect((await store.getActiveAbTest(tid, template.id, 'staging'))?.id).toBe(ab.id);

      // events-joining version analytics are deferred on Postgres (#175)
      await expect(store.getVersionAnalytics(template.id, tid)).rejects.toThrow(/Postgres/);

      await store.softDeleteTemplate(template.id, tid);
      expect(await store.getTemplate(template.id, tid)).toBeNull();
    });
  });

  // ─── #172 feature 3: evaluations via the dialect-agnostic stores ──
  describe('Evaluations (dialect-agnostic Eval/EvaluatorStore on Postgres)', () => {
    it('CRUDs datasets (atomic transaction), runs + results on pg', async () => {
      const store = new EvalStore(db);
      const tid = `tenant-${randomUUID().slice(0, 8)}`;
      // createDataset runs INSERTs in a dialect-agnostic transaction (runInTransaction)
      const ds = await store.createDataset(tid, {
        name: 'DS',
        testCases: [{ input: { q: 'a' }, expectedOutput: 'b' }, { input: { q: 'c' } }],
      });
      expect((await store.getDataset(tid, ds.id))?.name).toBe('DS');
      const cases = await store.getTestCases(ds.id);
      expect(cases).toHaveLength(2);

      const run = await store.createRun(tid, { datasetId: ds.id, agentId: 'agt', webhookUrl: 'http://x', config: {} });
      await store.saveResult({
        runId: run.id, testCaseId: cases[0].id, tenantId: tid,
        score: 0.875, passed: true, scorerType: 'exact_match',
        scorerDetails: { score: 0.875, passed: true, scorerType: 'exact_match' },
      });
      const results = await store.getResults(run.id);
      expect(results).toHaveLength(1);
      expect(results[0].score).toBeCloseTo(0.875, 6);

      // createVersion exercises the second transaction path (immutability snapshot)
      const v2 = await store.createVersion(tid, ds.id);
      expect(v2.version).toBe(2);
      expect(await store.getTestCases(v2.id)).toHaveLength(2);
    });

    it('EvaluatorStore CRUD + idempotent built-in seed (ON CONFLICT) on pg', async () => {
      const store = new EvaluatorStore(db);
      const tid = `tenant-${randomUUID().slice(0, 8)}`;
      const ev = await store.create(tid, { name: 'PII', scorerType: 'compliance', configTemplate: { type: 'compliance', rules: [] }, tags: ['pii'] });
      expect((await store.get(tid, ev.id))?.name).toBe('PII');
      expect((await store.publish(tid, ev.id))?.status).toBe('published');
      expect(await store.delete(tid, ev.id)).toBe(true);

      // seedBuiltins upserts via ON CONFLICT — re-seeding must be idempotent on pg
      await store.seedBuiltins(BUILTIN_EVALUATORS);
      await store.seedBuiltins(BUILTIN_EVALUATORS);
      expect((await store.list(tid, { builtin: true })).length).toBe(BUILTIN_EVALUATORS.length);
    });
  });
});
