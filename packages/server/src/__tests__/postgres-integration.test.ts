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
import { BenchmarkStore } from '../db/benchmark-store.js';
import { AnnotationStore } from '../db/annotation-store.js';
import { LlmConnectionStore } from '../db/llm-connection-store.js';
import { RetentionService } from '../db/services/retention-service.js';
import { HealthSnapshotStore } from '../db/health-snapshot-store.js';
import { NotificationChannelRepository } from '../db/repositories/notification-channel-repository.js';
import { UserStore } from '../db/user-store.js';
import { SsoConnectionStore } from '../db/sso-connection-store.js';
import { ScimGroupStore } from '../db/scim-group-store.js';
import { PostgresEventStore } from '../db/postgres-store.js';
import { getRollupAnalyticsAsync } from '../db/repositories/analytics-repository.js';
import { TenantScopedStore } from '../db/tenant-scoped-store.js';
import { computeEventHash } from '@agentkitai/agentlens-core';

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
        // #172 features 7-11: annotations, llm connections, chain anchors, health, notifications
        'annotation_queues', 'annotation_items', 'llm_connections', 'chain_anchors',
        'health_snapshots', 'notification_channels', 'notification_log',
        // #148: enterprise SSO connections + SCIM groups
        'sso_connections', 'scim_groups', 'scim_group_members',
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

    it('resolves user-centric membership + override-wins effective role on pg (#147)', async () => {
      const store = new OrgProjectStore(db);
      const u = `u_${randomUUID().slice(0, 8)}`;
      const orgA = await store.createOrg({ name: 'OA', slug: `oa-${randomUUID().slice(0, 8)}` });
      const orgB = await store.createOrg({ name: 'OB', slug: `ob-${randomUUID().slice(0, 8)}` });
      const projA = await store.createProject(orgA.id, { name: 'PA', slug: `pa-${randomUUID().slice(0, 8)}` });
      await store.addOrgMember(orgA.id, u, 'member');
      await store.addOrgMember(orgB.id, u, 'admin');

      const orgs = (await store.listUserOrgs(u)).map((o) => o.org.id);
      expect(orgs).toContain(orgA.id);
      expect(orgs).toContain(orgB.id);
      expect(await store.getEffectiveRole(projA.id, u)).toBe('member'); // inherits org role
      await store.addProjectMember(projA.id, u, 'viewer');
      expect(await store.getEffectiveRole(projA.id, u)).toBe('viewer'); // override wins
      expect(await store.getEffectiveRole(projA.id, 'nobody')).toBeNull();
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

      // events-joining version analytics now work on Postgres (#175).
      const pgStore = new PostgresEventStore(db);
      const scoped = new TenantScopedStore(pgStore, tid);
      const mkEvent = (over: Record<string, unknown>) => {
        const base = {
          id: `e_${randomUUID()}`, timestamp: '2026-06-15T10:00:00Z',
          sessionId: `s_${randomUUID().slice(0, 6)}`, agentId: 'agt-x',
          eventType: 'custom', severity: 'info', payload: {}, metadata: {}, prevHash: null,
          ...over,
        };
        return { ...base, hash: computeEventHash(base), tenantId: tid };
      };
      await scoped.insertEvents([
        mkEvent({ eventType: 'llm_call', payload: { promptVersionId: version.id, callId: 'c1' }, metadata: { verifiedAgentId: 'agt-x' } }) as never,
        mkEvent({ eventType: 'llm_response', payload: { callId: 'c1', costUsd: 0.02, latencyMs: 120, finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 } } }) as never,
      ]);

      const analytics = await store.getVersionAnalytics(template.id, tid);
      const vRow = analytics.find((a) => a.versionId === version.id);
      expect(vRow?.callCount).toBe(1);
      expect(vRow?.totalCostUsd).toBeCloseTo(0.02, 6);
      expect(vRow?.avgLatencyMs).toBeCloseTo(120, 6);
      expect(vRow?.avgInputTokens).toBeCloseTo(10, 6);

      const byAgent = await store.getVersionAnalyticsByAgent(template.id, tid);
      const aRow = byAgent.find((a) => a.versionId === version.id);
      expect(aRow?.agentId).toBe('agt-x');
      expect(aRow?.verified).toBe(true);
      expect(aRow?.callCount).toBe(1);
      expect(aRow?.totalCostUsd).toBeCloseTo(0.02, 6);

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

  // ─── #172 feature 6: benchmarks via the dialect-agnostic store ──
  describe('Benchmarks (dialect-agnostic BenchmarkStore on Postgres)', () => {
    it('creates (atomic transaction) + lists (COUNT→number) + results on pg', async () => {
      const store = new BenchmarkStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      // create runs the benchmark + variant inserts atomically (runInTransaction)
      const bm = await store.create(tid, {
        name: 'B', metrics: [],
        variants: [{ name: 'V1', tag: 'control' }, { name: 'V2', tag: 'treatment' }],
      } as never);
      expect(bm.variants).toHaveLength(2);
      expect((await store.getById(tid, bm.id))?.variants).toHaveLength(2);

      // list().total must be a NUMBER on pg (COUNT returns a string otherwise)
      const listed = await store.list(tid, {});
      expect(listed.total).toBe(1);
      expect(typeof listed.total).toBe('number');

      expect((await store.updateStatus(tid, bm.id, 'running')).status).toBe('running');

      await store.saveResults(tid, bm.id, { variants: [], comparisons: [], summary: 's', computedAt: '2026-06-30T00:00:00Z' } as never);
      expect((await store.getResults(tid, bm.id))?.summary).toBe('s');

      // delete is only allowed for draft/cancelled — use a fresh draft benchmark
      const bm2 = await store.create(tid, {
        name: 'B2', metrics: [],
        variants: [{ name: 'A', tag: 'a' }, { name: 'B', tag: 'b' }],
      } as never);
      expect(await store.delete(tid, bm2.id)).toBe(true);
      expect(await store.getById(tid, bm2.id)).toBeNull();
    });
  });

  // ─── #172 feature 7: annotations via the dialect-agnostic store ──
  describe('Annotations (dialect-agnostic AnnotationStore on Postgres)', () => {
    it('CRUDs queues + items + claim/score/skip lifecycle on pg', async () => {
      const store = new AnnotationStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const queue = await store.createQueue(tid, { name: 'Q', config: { foo: 1 } });
      expect((await store.getQueue(tid, queue.id))?.name).toBe('Q');
      expect((await store.listQueues(tid)).length).toBe(1);

      const items = await store.addItems(tid, queue.id, [{ sessionId: 's1' }, { sessionId: 's2' }]);
      expect(items).toHaveLength(2);
      expect((await store.listItems(tid, queue.id)).length).toBe(2);
      expect((await store.listItems(tid, queue.id, { status: 'pending' })).length).toBe(2);

      const claim = await store.claimItem(tid, items[0].id, 'reviewer-1');
      expect(claim.ok).toBe(true);
      expect((await store.getItem(tid, items[0].id))?.status).toBe('in_review');
      // a second claim on the same item must fail (only transitions from pending)
      expect((await store.claimItem(tid, items[0].id, 'reviewer-2')).ok).toBe(false);

      expect((await store.markScored(tid, items[0].id, 'evt-1'))?.status).toBe('scored');
      expect((await store.skipItem(tid, items[1].id))?.status).toBe('skipped');

      // FK ON DELETE CASCADE: deleting the queue removes its items
      await db.execute(sql`DELETE FROM annotation_queues WHERE id = ${queue.id}`);
      expect(await store.listItems(tid, queue.id)).toHaveLength(0);
    });
  });

  // ─── #172 feature 8: llm_connections via the dialect-agnostic store ──
  describe('LLM connections (dialect-agnostic LlmConnectionStore on Postgres)', () => {
    it('CRUDs connections + masks the key + decrypts internally on pg', async () => {
      process.env.AGENTLENS_ENCRYPTION_KEY = 'pg-test-key'; // required by lib/secret-box
      try {
        const store = new LlmConnectionStore(db);
        const tid = `t_${randomUUID().slice(0, 8)}`;
        const conn = await store.create(tid, { provider: 'openai', name: 'C', apiKey: 'sk-secret-1234', createdBy: 'u1' } as never);
        expect(conn.keyLast4).toBe('1234');
        expect((conn as Record<string, unknown>).apiKey).toBeUndefined(); // never exposed

        expect((await store.list(tid)).length).toBe(1);
        expect((await store.get(tid, conn.id))?.name).toBe('C');

        // internal getWithKey decrypts the AES-256-GCM ciphertext round-trip
        expect((await store.getWithKey(tid, conn.id))?.apiKey).toBe('sk-secret-1234');

        expect(await store.get('other-tenant', conn.id)).toBeUndefined(); // tenant isolation
        expect(await store.delete(tid, conn.id)).toBe(true);
        expect(await store.get(tid, conn.id)).toBeUndefined();
      } finally {
        delete process.env.AGENTLENS_ENCRYPTION_KEY;
      }
    });
  });

  // ─── #172 feature 9: chain_anchors via the dialect-agnostic RetentionService ──
  describe('Chain anchors / retention (dialect-agnostic RetentionService on Postgres)', () => {
    it('verifies a segment, writes a signed chain_anchor, then purges on pg', async () => {
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const sid = `s_${randomUUID().slice(0, 8)}`;
      // Build a valid 2-event hash chain (old enough to be eligible for retention).
      let prev: string | null = null;
      for (let i = 0; i < 2; i++) {
        const base = {
          id: `e_${randomUUID()}`,
          timestamp: `2020-01-0${i + 1}T00:00:00Z`,
          sessionId: sid, agentId: 'agt', eventType: 'custom', severity: 'info',
          payload: { i }, metadata: {}, prevHash: prev,
        };
        const hash = computeEventHash(base);
        await db.execute(sql`INSERT INTO events
          (id, timestamp, session_id, agent_id, event_type, severity, payload, metadata, prev_hash, hash, tenant_id)
          VALUES (${base.id}, ${base.timestamp}, ${sid}, ${'agt'}, ${'custom'}, ${'info'},
                  ${JSON.stringify(base.payload)}::jsonb, ${JSON.stringify(base.metadata)}::jsonb, ${prev}, ${hash}, ${tid})`);
        prev = hash;
      }

      const result = await new RetentionService(db).applyRetention('2020-12-31T00:00:00Z', tid);
      expect(result.deletedCount).toBe(2);
      expect((result as { anchoredSegments: number }).anchoredSegments).toBe(1);

      // a tamper-evident anchor was written, and the raw events are purged
      const anchors = await db.execute(sql`SELECT * FROM chain_anchors WHERE tenant_id = ${tid} AND session_id = ${sid}`);
      expect(anchors.rows).toHaveLength(1);
      expect(Number(anchors.rows[0].event_count)).toBe(2);
      const left = await db.execute(sql`SELECT COUNT(*) as c FROM events WHERE session_id = ${sid}`);
      expect(Number(left.rows[0].c)).toBe(0);
    });
  });

  // ─── #172 feature 10: health_snapshots via the dialect-agnostic store ──
  describe('Health snapshots (dialect-agnostic HealthSnapshotStore on Postgres)', () => {
    it('upserts (ON CONFLICT) + history + latest + cleanup on pg', async () => {
      const store = new HealthSnapshotStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const snap = (date: string, score: number) => ({
        agentId: 'agt', date,
        overallScore: score, errorRateScore: score, costEfficiencyScore: score,
        toolSuccessScore: score, latencyScore: score, completionRateScore: score,
        sessionCount: 3,
      });
      await store.save(tid, snap('2026-06-01', 70));
      await store.save(tid, snap('2026-06-01', 90)); // same (agent,date) → ON CONFLICT replace
      expect((await store.get(tid, 'agt', '2026-06-01'))?.overallScore).toBe(90);

      await store.save(tid, snap('2026-06-02', 80));
      expect((await store.getHistory(tid, 'agt', 3650)).length).toBeGreaterThanOrEqual(2);
      expect((await store.getLatest(tid)).get('agt')?.date).toBe('2026-06-02');

      // cleanup returns a Number (dbRunCount coercion); 1-day retention purges old rows
      const removed = await store.cleanup(tid, 1);
      expect(typeof removed).toBe('number');
      expect(removed).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── #172 feature 11 (final): notifications via the dialect-agnostic repo ──
  describe('Notifications (dialect-agnostic NotificationChannelRepository on Postgres)', () => {
    it('CRUDs channels (boolean enabled) + log on pg', async () => {
      const repo = new NotificationChannelRepository(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const cid = `ch_${randomUUID()}`;
      await repo.createChannel({
        id: cid, tenantId: tid, type: 'slack', name: 'Ops',
        config: { url: 'https://x' }, enabled: true,
        createdAt: '2026-06-30T00:00:00Z', updatedAt: '2026-06-30T00:00:00Z',
      } as never);

      const got = await repo.getChannel(cid, tid);
      expect(got?.enabled).toBe(true); // boolean round-trip on pg (vs sqlite 0/1)
      expect(got?.config).toEqual({ url: 'https://x' });
      expect((await repo.listChannels(tid)).length).toBe(1);

      await repo.updateChannel(cid, { enabled: false, name: 'Ops2', updatedAt: '2026-06-30T01:00:00Z' }, tid);
      const upd = await repo.getChannel(cid, tid);
      expect(upd?.enabled).toBe(false);
      expect(upd?.name).toBe('Ops2');

      await repo.insertLog({
        id: `lg_${randomUUID()}`, tenantId: tid, channelId: cid,
        status: 'sent', attempt: 1, createdAt: '2026-06-30T00:01:00Z',
      } as never);
      const log = await repo.listLog({ tenantId: tid });
      expect(typeof log.total).toBe('number'); // COUNT coercion
      expect(log.total).toBe(1);
      expect(log.entries[0]?.status).toBe('sent');

      await repo.deleteChannel(cid, tid);
      expect(await repo.getChannel(cid, tid)).toBeNull();
      await expect(repo.deleteChannel(cid, tid)).rejects.toThrow(); // NotFoundError
    });
  });

  // ─── #148 (Phase 7): dialect-agnostic UserStore (SCIM provisioning) on pg ──
  describe('UserStore (SCIM provisioning) on Postgres (#148)', () => {
    it('provisions + lists/filters + deactivates + deletes users on pg', async () => {
      const store = new UserStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const u = await store.create({ tenantId: tid, email: 'scim@pg.com', displayName: 'SCIM PG' });
      expect(u.active).toBe(true);
      expect((await store.getByEmail(tid, 'scim@pg.com'))?.id).toBe(u.id);

      const listed = await store.list(tid, { email: 'scim@pg.com' });
      expect(listed.total).toBe(1);
      expect(typeof listed.total).toBe('number'); // COUNT coercion

      // deactivate (SCIM active:false → disabled_at)
      expect((await store.update(u.id, { active: false }))?.active).toBe(false);
      expect((await store.update(u.id, { active: true }))?.active).toBe(true);

      expect(await store.delete(u.id)).toBe(true);
      expect(await store.getById(u.id)).toBeUndefined();
    });
  });

  // ─── #148 (Phase 7): dialect-agnostic SsoConnectionStore on pg ──
  describe('SsoConnectionStore on Postgres (#148)', () => {
    it('CRUDs SSO connections + domain enforcement lookup on pg', async () => {
      const store = new SsoConnectionStore(db);
      const org = `org_${randomUUID().slice(0, 8)}`;
      const domain = `${randomUUID().slice(0, 6)}.com`;
      const conn = await store.create({
        orgId: org, type: 'saml', name: 'Okta PG', domain,
        config: { ssoUrl: 'https://idp/sso' },
        groupRoleMappings: { admins: 'admin' },
      });
      expect(conn.enabled).toBe(false); // INTEGER 0 → boolean false on pg
      expect(conn.config.ssoUrl).toBe('https://idp/sso');
      expect((await store.listByOrg(org)).map((c) => c.id)).toEqual([conn.id]);

      // not enforced yet → no domain match
      expect(await store.getEnforcedByDomain(domain)).toBeUndefined();
      await store.update(conn.id, { enabled: true, domainVerified: true, enforced: true });
      expect((await store.getEnforcedByDomain(domain))?.id).toBe(conn.id);

      expect(await store.delete(conn.id)).toBe(true);
      expect(await store.getById(conn.id)).toBeUndefined();
    });
  });

  // ─── #148 (Phase 7): dialect-agnostic ScimGroupStore (SCIM groups) on pg ──
  describe('ScimGroupStore on Postgres (#148)', () => {
    it('CRUDs groups + members (ON CONFLICT add) on pg', async () => {
      const store = new ScimGroupStore(db);
      const tid = `t_${randomUUID().slice(0, 8)}`;
      const g = await store.create({ tenantId: tid, displayName: 'Eng', memberIds: ['u1'] });
      expect(g.memberIds).toEqual(['u1']);
      expect((await store.getById(g.id))?.displayName).toBe('Eng');

      const listed = await store.list(tid, { displayName: 'Eng' });
      expect(listed.total).toBe(1);
      expect(typeof listed.total).toBe('number'); // COUNT coercion

      await store.addMember(g.id, 'u2');
      await store.addMember(g.id, 'u2'); // idempotent via ON CONFLICT
      expect((await store.getById(g.id))?.memberIds.sort()).toEqual(['u1', 'u2']);
      await store.removeMember(g.id, 'u1');
      expect((await store.getById(g.id))?.memberIds).toEqual(['u2']);
      await store.setMembers(g.id, ['u3', 'u4']);
      expect((await store.getById(g.id))?.memberIds.sort()).toEqual(['u3', 'u4']);

      expect(await store.delete(g.id)).toBe(true);
      expect(await store.getById(g.id)).toBeUndefined();
    });
  });

  // ─── #147 (Phase 7): org/project stamped at insert on the Postgres path ──
  describe('Org/project stamping on Postgres (#147)', () => {
    it('stamps the scope org_id/project_id onto inserted events on pg', async () => {
      const pgStore = new PostgresEventStore(db);
      const scoped = new TenantScopedStore(pgStore, 'tenant-pg', { orgId: 'org-pg', projectId: 'proj-pg' });
      const sid = `s_${randomUUID().slice(0, 8)}`;
      const base = {
        id: `e_${randomUUID()}`, timestamp: '2026-06-30T00:00:00Z',
        sessionId: sid, agentId: 'agt', eventType: 'custom', severity: 'info',
        payload: {}, metadata: {}, prevHash: null,
      };
      const hash = computeEventHash(base);
      await scoped.insertEvents([{ ...base, hash, tenantId: 'tenant-pg' } as never]);

      const r = await db.execute(sql`SELECT org_id, project_id, tenant_id FROM events WHERE id = ${base.id}`);
      expect(r.rows[0].tenant_id).toBe('tenant-pg');
      expect(r.rows[0].org_id).toBe('org-pg');
      expect(r.rows[0].project_id).toBe('proj-pg');
    });

    it('isolates reads across projects within the same tenant on pg', async () => {
      const pgStore = new PostgresEventStore(db);
      const projA = new TenantScopedStore(pgStore, 'shared-pg', { orgId: 'o', projectId: 'pa' });
      const projB = new TenantScopedStore(pgStore, 'shared-pg', { orgId: 'o', projectId: 'pb' });
      const mk = (sid: string) => {
        const base = {
          id: `e_${randomUUID()}`, timestamp: '2026-06-30T00:00:00Z',
          sessionId: sid, agentId: 'a', eventType: 'custom', severity: 'info',
          payload: {}, metadata: {}, prevHash: null,
        };
        return { ...base, hash: computeEventHash(base), tenantId: 'shared-pg' };
      };
      const ea = mk(`sa_${randomUUID().slice(0, 6)}`);
      const eb = mk(`sb_${randomUUID().slice(0, 6)}`);
      await projA.insertEvents([ea as never]);
      await projB.insertEvents([eb as never]);

      const idsA = (await projA.queryEvents({})).events.map((e) => e.id);
      expect(idsA).toContain(ea.id);
      expect(idsA).not.toContain(eb.id); // same tenant, different project → isolated
      expect(await projA.getEvent(eb.id)).toBeNull();
      expect(await projA.getEvent(ea.id)).not.toBeNull();

      // sessions are project-isolated too (stamped from the event's project)
      const sessA = (await projA.querySessions({})).sessions.map((s) => s.id);
      expect(sessA).toContain(ea.sessionId);
      expect(sessA).not.toContain(eb.sessionId);
      expect(await projA.getSession(eb.sessionId)).toBeNull();
      expect(await projA.getSession(ea.sessionId)).not.toBeNull();

      // agents are project-isolated: agent 'a' is stamped to project pa (first writer),
      // so project pb cannot see it.
      expect((await projA.listAgents()).map((a) => a.id)).toEqual(['a']);
      expect(await projA.getAgent('a')).not.toBeNull();
      expect(await projB.getAgent('a')).toBeNull();

      // countEventsBatch + analytics are project-scoped: both events share tenant
      // 'shared-pg' + agentId 'a', so WITHOUT the project filter these would be 2.
      const from = '2000-01-01T00:00:00Z';
      const to = '2100-01-01T00:00:00Z';
      expect((await projA.countEventsBatch({ agentId: 'a', from, to })).total).toBe(1);
      expect((await projA.getAnalytics({ from, to, granularity: 'day', agentId: 'a' })).totals.eventCount).toBe(1);
    });
  });

  // ─── #180: cost_rollups populated on the Postgres ingest path ──
  describe('Cost rollups on Postgres (#180)', () => {
    it('populates and accumulates cost_rollups on insertEvents', async () => {
      const tid = `tenant-${randomUUID().slice(0, 8)}`;
      const scoped = new TenantScopedStore(new PostgresEventStore(db), tid);
      const mk = (over: Record<string, unknown>) => {
        const base = {
          id: `e_${randomUUID()}`, timestamp: '2026-06-15T10:00:00Z',
          sessionId: `s_${randomUUID().slice(0, 6)}`, agentId: 'agt_x',
          eventType: 'custom', severity: 'info', payload: {}, metadata: { verifiedAgentId: 'agt_x' }, prevHash: null,
          ...over,
        };
        return { ...base, hash: computeEventHash(base), tenantId: tid };
      };

      await scoped.insertEvents([
        mk({ eventType: 'llm_call', payload: { model: 'gpt-4o' } }) as never,
        mk({ eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.05, latencyMs: 120, usage: { inputTokens: 100, outputTokens: 50 } } }) as never,
      ]);

      const r1 = (await db.execute(sql`
        SELECT event_count, llm_call_count, cost_usd, input_tokens, verified_agent_id, model
        FROM cost_rollups WHERE tenant_id = ${tid}
      `)).rows;
      expect(r1).toHaveLength(1);
      expect(r1[0].verified_agent_id).toBe('agt_x');
      expect(r1[0].model).toBe('gpt-4o');
      expect(Number(r1[0].event_count)).toBe(2);
      expect(Number(r1[0].llm_call_count)).toBe(1);
      expect(Number(r1[0].cost_usd)).toBeCloseTo(0.05, 6);
      expect(Number(r1[0].input_tokens)).toBe(100);

      // A second batch in the SAME hour accumulates into the same bucket.
      await scoped.insertEvents([
        mk({ timestamp: '2026-06-15T10:45:00Z', eventType: 'llm_response', payload: { model: 'gpt-4o', costUsd: 0.03, latencyMs: 80, usage: { inputTokens: 20, outputTokens: 10 } } }) as never,
      ]);
      const r2 = (await db.execute(sql`SELECT event_count, cost_usd, input_tokens FROM cost_rollups WHERE tenant_id = ${tid}`)).rows;
      expect(Number(r2[0].event_count)).toBe(3);
      expect(Number(r2[0].cost_usd)).toBeCloseTo(0.08, 6);
      expect(Number(r2[0].input_tokens)).toBe(120);
    });
  });

  // ─── #220: read cost_rollups dialect-agnostically (getRollupAnalytics on pg) ──
  describe('Rollup analytics on Postgres (#220)', () => {
    it('reads cost_rollups via getRollupAnalyticsAsync (Number-coerced)', async () => {
      const tid = `tenant-${randomUUID().slice(0, 8)}`;
      await db.execute(sql`
        INSERT INTO cost_rollups
          (tenant_id, verified_agent_id, model, bucket_start, granularity, event_count, tool_call_count,
           error_count, llm_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
           cost_usd, latency_sum_ms, latency_count, pricing_versions, updated_at)
        VALUES (${tid}, 'agt-x', 'gpt-4o', '2026-06-15T10:00:00Z', 'hour', 5, 2, 1, 3, 100, 50, 0, 0,
                0.05, 300, 3, '[]', '2026-06-15T10:00:00Z')
      `);

      const r = await getRollupAnalyticsAsync(db, { tenantId: tid, from: '2026-06-01T00:00:00Z', to: '2026-07-01T00:00:00Z' });
      expect(r.totals.eventCount).toBe(5);
      expect(r.totals.costUsd).toBeCloseTo(0.05, 6);
      expect(r.totals.llmCallCount).toBe(3);
      expect(r.byAgent).toHaveLength(1);
      expect(r.byAgent[0]!.verifiedAgentId).toBe('agt-x');
      expect(r.byAgent[0]!.costUsd).toBeCloseTo(0.05, 6);
      expect(r.buckets).toHaveLength(1);
      expect(r.buckets[0]!.bucket).toBe('2026-06-15T00:00:00Z'); // day granularity
      expect(r.buckets[0]!.eventCount).toBe(5);
      expect(r.buckets[0]!.avgLatencyMs).toBeCloseTo(100, 6); // 300 / 3
    });
  });

  // ─── #252: MediaStore on Postgres (dialect-agnostic offload storage) ──
  describe('MediaStore on Postgres (#252)', () => {
    it('stores and fetches a media blob, scoped to the tenant', async () => {
      const { MediaStore } = await import('../db/media-store.js');
      const s = new MediaStore(db);
      const id = await s.store('t-media-252', 'image/png', 'QUJD');
      const got = await s.fetch('t-media-252', id);
      expect(got?.contentType).toBe('image/png');
      expect(got?.data).toBe('QUJD');
      expect(await s.fetch('other-tenant', id)).toBeNull();
    });
  });

  // ─── #253: prompt folders + GitHub sync config on Postgres ──
  describe('Prompt folders + GitHub sync on Postgres (#253)', () => {
    it('round-trips a prompt folder and an (encrypted) github sync config', async () => {
      const { PromptStore } = await import('../db/prompt-store.js');
      const ps = new PromptStore(db);
      await ps.createTemplate('t-253', { name: 'p1', content: 'x', folder: 'f/a' });
      await ps.createTemplate('t-253', { name: 'p2', content: 'y' });
      const listed = await ps.listTemplates({ tenantId: 't-253', folder: 'f/a' });
      expect(listed.templates.map((t) => t.name)).toEqual(['p1']);

      const prev = process.env.AGENTLENS_ENCRYPTION_KEY;
      process.env.AGENTLENS_ENCRYPTION_KEY = 'pg-test-key-253';
      try {
        const { PromptGithubSyncStore } = await import('../lib/prompt-github-sync.js');
        const gh = new PromptGithubSyncStore(db);
        await gh.setConfig('t-253', { owner: 'o', repo: 'r', token: 'ghp_abcd' });
        const cfg = await gh.getConfig('t-253');
        expect(cfg?.owner).toBe('o');
        expect(cfg?.tokenLast4).toBe('abcd');
        expect(await gh.getToken('t-253')).toBe('ghp_abcd');
      } finally {
        process.env.AGENTLENS_ENCRYPTION_KEY = prev;
      }
    });
  });

  // ─── #254: LiveEval config on Postgres ──
  describe('LiveEval config on Postgres (#254)', () => {
    it('round-trips the live-eval config', async () => {
      const { LiveEvalStore } = await import('../lib/eval/live-eval.js');
      const s = new LiveEvalStore(db);
      await s.set('t-254', { enabled: true, samplingRate: 0.5, scorerType: 'regex', scorerConfig: { type: 'regex', pattern: 'ok' } as any });
      const got = await s.get('t-254');
      expect(got?.enabled).toBe(true);
      expect(got?.samplingRate).toBe(0.5);
      expect((got?.scorerConfig as any).pattern).toBe('ok');
    });
  });
});
