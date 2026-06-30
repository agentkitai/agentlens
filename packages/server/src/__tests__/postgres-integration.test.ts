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
import { CostBudgetStore } from '../db/cost-budget-store.js';
import { GuardrailStore } from '../db/guardrail-store.js';

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
        // #172 feature 4 (schema step): cost-management tables on the pg path
        'cost_budgets', 'cost_budget_state', 'cost_anomaly_config', 'cost_rollups',
        // #172 feature 5 (schema step): guardrail tables on the pg path
        'guardrail_rules', 'guardrail_state', 'guardrail_trigger_history',
        // #172 feature 6 (schema step): benchmark tables on the pg path
        'benchmarks', 'benchmark_variants', 'benchmark_results',
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

    it('cost tables accept the store columns (composite PK rollup, double cost)', async () => {
      // Smoke-test the 0010 schema for the dialect-agnostic CostBudgetStore/rollup (next PR).
      const tid = `t_${randomUUID().slice(0, 8)}`;
      await db.execute(sql`INSERT INTO cost_budgets (id, tenant_id, scope, period, limit_usd, on_breach, enabled, created_at, updated_at)
        VALUES (${`b_${randomUUID()}`}, ${tid}, 'tenant', 'monthly', 100.5, 'alert', 1, '2026-06-30T00:00:00Z', '2026-06-30T00:00:00Z')`);
      // cost_rollups has a 5-column PK — insert + ON CONFLICT upsert path
      await db.execute(sql`INSERT INTO cost_rollups (tenant_id, verified_agent_id, model, bucket_start, granularity, cost_usd, updated_at)
        VALUES (${tid}, 'agt', 'claude', '2026-06-30T00:00:00Z', 'hour', 1.25, '2026-06-30T00:00:00Z')
        ON CONFLICT (tenant_id, verified_agent_id, model, bucket_start, granularity)
        DO UPDATE SET cost_usd = cost_rollups.cost_usd + 0.75`);
      await db.execute(sql`INSERT INTO cost_rollups (tenant_id, verified_agent_id, model, bucket_start, granularity, cost_usd, updated_at)
        VALUES (${tid}, 'agt', 'claude', '2026-06-30T00:00:00Z', 'hour', 1.25, '2026-06-30T00:00:00Z')
        ON CONFLICT (tenant_id, verified_agent_id, model, bucket_start, granularity)
        DO UPDATE SET cost_usd = cost_rollups.cost_usd + 0.75`);
      const r = await db.execute(sql`SELECT cost_usd FROM cost_rollups WHERE tenant_id = ${tid}`);
      expect(Number(r.rows[0].cost_usd)).toBeCloseTo(2.0, 6); // 1.25 + 0.75 (upsert)
    });

    it('guardrail tables accept the store columns (state ON CONFLICT, double value)', async () => {
      // Smoke-test the 0011 schema for the dialect-agnostic GuardrailStore (next PR).
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const rid = `r_${randomUUID()}`;
      await db.execute(sql`INSERT INTO guardrail_rules (id, tenant_id, name, enabled, condition_type, action_type, created_at, updated_at)
        VALUES (${rid}, ${tid}, 'rule', 1, 'cost_threshold', 'alert', '2026-06-30T00:00:00Z', '2026-06-30T00:00:00Z')`);
      // guardrail_state has a 2-column PK — upsert sets columns from params (no self-ref)
      await db.execute(sql`INSERT INTO guardrail_state (rule_id, tenant_id, trigger_count, current_value)
        VALUES (${rid}, ${tid}, 1, 4.5)
        ON CONFLICT (rule_id, tenant_id) DO UPDATE SET trigger_count = 2, current_value = 9.5`);
      await db.execute(sql`INSERT INTO guardrail_state (rule_id, tenant_id, trigger_count, current_value)
        VALUES (${rid}, ${tid}, 1, 4.5)
        ON CONFLICT (rule_id, tenant_id) DO UPDATE SET trigger_count = 2, current_value = 9.5`);
      const r = await db.execute(sql`SELECT trigger_count, current_value FROM guardrail_state WHERE rule_id = ${rid}`);
      expect(Number(r.rows[0].trigger_count)).toBe(2);
      expect(Number(r.rows[0].current_value)).toBeCloseTo(9.5, 6);
    });

    it('benchmark tables accept the store columns (variants + results + COUNT)', async () => {
      // Smoke-test the 0012 schema for the dialect-agnostic BenchmarkStore (next PR).
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const bid = `bm_${randomUUID()}`;
      await db.execute(sql`INSERT INTO benchmarks (id, tenant_id, name, status, metrics, min_sessions_per_variant, created_at, updated_at)
        VALUES (${bid}, ${tid}, 'B', 'draft', '[]', 10, '2026-06-30T00:00:00Z', '2026-06-30T00:00:00Z')`);
      await db.execute(sql`INSERT INTO benchmark_variants (id, benchmark_id, tenant_id, name, tag, sort_order)
        VALUES (${`v_${randomUUID()}`}, ${bid}, ${tid}, 'V1', 'control', 0)`);
      await db.execute(sql`INSERT INTO benchmark_variants (id, benchmark_id, tenant_id, name, tag, sort_order)
        VALUES (${`v_${randomUUID()}`}, ${bid}, ${tid}, 'V2', 'treatment', 1)`);
      await db.execute(sql`INSERT INTO benchmark_results (id, benchmark_id, tenant_id, variant_metrics, comparisons, computed_at)
        VALUES (${`res_${randomUUID()}`}, ${bid}, ${tid}, '[]', '[]', '2026-06-30T00:00:00Z')`);
      // pg returns COUNT(*) as a string — the store must Number()-coerce
      const c = await db.execute(sql`SELECT COUNT(*) as cnt FROM benchmark_variants WHERE benchmark_id = ${bid}`);
      expect(Number(c.rows[0].cnt)).toBe(2);
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

  // ─── #172 feature 4: cost budgets via the dialect-agnostic store ──
  describe('Cost budgets (dialect-agnostic CostBudgetStore on Postgres)', () => {
    it('CRUDs budgets + upserts state/anomaly config (ON CONFLICT) on pg', async () => {
      const store = new CostBudgetStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const id = `b_${randomUUID()}`;
      const now = '2026-06-30T00:00:00Z';
      await store.createBudget({
        id, tenantId: tid, scope: 'tenant', period: 'monthly', limitUsd: 100.5,
        onBreach: 'alert', enabled: true, createdAt: now, updatedAt: now,
      });
      expect((await store.getBudget(tid, id))?.limitUsd).toBeCloseTo(100.5, 6);
      expect((await store.listBudgets(tid, { enabled: true })).length).toBe(1);

      expect(await store.updateBudget(tid, id, { limitUsd: 200 })).toBe(true);
      expect((await store.getBudget(tid, id))?.limitUsd).toBe(200);

      // state upsert (ON CONFLICT on the 2-column PK), set from params
      await store.upsertState({ budgetId: id, tenantId: tid, breachCount: 1, currentSpend: 50 });
      await store.upsertState({ budgetId: id, tenantId: tid, breachCount: 2, currentSpend: 75 });
      expect((await store.getState(tid, id))?.breachCount).toBe(2);

      // anomaly config upsert (ON CONFLICT on tenant_id)
      await store.upsertAnomalyConfig({ tenantId: tid, multiplier: 3.5, minSessions: 5, enabled: true, updatedAt: now });
      await store.upsertAnomalyConfig({ tenantId: tid, multiplier: 4.0, minSessions: 8, enabled: false, updatedAt: now });
      const cfg = await store.getAnomalyConfig(tid);
      expect(cfg?.multiplier).toBeCloseTo(4.0, 6);
      expect(cfg?.enabled).toBe(false);

      expect(await store.deleteBudget(tid, id)).toBe(true);
      expect(await store.getBudget(tid, id)).toBeNull();
    });
  });

  // ─── #172 feature 5: guardrails via the dialect-agnostic store ──
  describe('Guardrails (dialect-agnostic GuardrailStore on Postgres)', () => {
    it('CRUDs rules + upserts state + records triggers on pg', async () => {
      const store = new GuardrailStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const rid = `r_${randomUUID()}`;
      const now = '2026-06-30T00:00:00Z';
      await store.createRule({
        id: rid, tenantId: tid, name: 'R', enabled: true,
        conditionType: 'cost_threshold', conditionConfig: { threshold: 10 },
        actionType: 'alert', actionConfig: { channel: 'x' },
        cooldownMinutes: 15, dryRun: false, createdAt: now, updatedAt: now,
      } as never);
      expect((await store.getRule(tid, rid))?.name).toBe('R');
      expect((await store.listEnabledRules(tid)).length).toBe(1);

      expect(await store.updateRule(tid, rid, { enabled: false })).toBe(true);
      expect((await store.getRule(tid, rid))?.enabled).toBe(false);

      // state upsert (2-col PK, params-only ON CONFLICT)
      await store.upsertState({ ruleId: rid, tenantId: tid, triggerCount: 1, currentValue: 4.5 } as never);
      await store.upsertState({ ruleId: rid, tenantId: tid, triggerCount: 2, currentValue: 9.5 } as never);
      const state = await store.getState(tid, rid);
      expect(state?.triggerCount).toBe(2);
      expect(state?.currentValue).toBeCloseTo(9.5, 6);

      // trigger history + stats
      await store.insertTrigger({
        id: `h_${randomUUID()}`, ruleId: rid, tenantId: tid, triggeredAt: now,
        conditionValue: 12.5, conditionThreshold: 10, actionExecuted: true, metadata: {},
      } as never);
      expect((await store.getRecentTriggers(tid, rid)).length).toBe(1);
      expect((await store.getTriggerStats(tid, '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).total).toBe(1);

      // delete cascades state + history
      expect(await store.deleteRule(tid, rid)).toBe(true);
      expect(await store.getRule(tid, rid)).toBeNull();
      expect(await store.getState(tid, rid)).toBeNull();
    });
  });
});
