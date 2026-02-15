/**
 * Tests for Agent Model Override & Pause Columns Migration (B1 — Story 1.2)
 *
 * Tests:
 * 1. Migration adds new columns to agents table
 * 2. Migration is idempotent (safe to run twice)
 * 3. Agent query returns new fields (modelOverride, pausedAt, pauseReason)
 * 4. PUT /api/agents/:id/unpause clears pause state
 * 5. pause_agent action handler writes to DB
 * 6. downgrade_model action handler writes to DB
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestApp, authHeaders, type TestContext } from './test-helpers.js';
import { runMigrations } from '../db/migrate.js';
import { createTestDb } from '../db/index.js';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { agents } from '../db/schema.sqlite.js';
import { eq, and } from 'drizzle-orm';

describe('Agent Pause/Override Migration (B1 — Story 1.2)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestApp({ authDisabled: false });
  });

  describe('Migration', () => {
    it('should add model_override, paused_at, pause_reason columns to agents', () => {
      // The test app already runs migrations.
      // Verify the columns exist by querying PRAGMA table_info
      const columns = ctx.db.all<{ name: string }>(sql`PRAGMA table_info(agents)`);
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('model_override');
      expect(colNames).toContain('paused_at');
      expect(colNames).toContain('pause_reason');
    });

    it('should be idempotent — running migrations twice succeeds', () => {
      // Run migrations again on the same DB
      expect(() => runMigrations(ctx.db)).not.toThrow();

      // Verify columns still exist
      const columns = ctx.db.all<{ name: string }>(sql`PRAGMA table_info(agents)`);
      const colNames = columns.map((c) => c.name);
      expect(colNames).toContain('model_override');
      expect(colNames).toContain('paused_at');
      expect(colNames).toContain('pause_reason');
    });

    it('should create idx_agents_paused index', () => {
      const indexes = ctx.db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agents'`,
      );
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_agents_paused');
    });
  });

  describe('Agent query with new fields', () => {
    it('should return agent with new nullable fields (undefined when null)', async () => {
      // Create an agent via event store
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({
        id: 'agent-test-1',
        name: 'Test Agent',
        tenantId: 'default',
      });

      const agent = await store.getAgent('agent-test-1', 'default');
      expect(agent).toBeTruthy();
      expect(agent!.modelOverride).toBeUndefined();
      expect(agent!.pausedAt).toBeUndefined();
      expect(agent!.pauseReason).toBeUndefined();
    });

    it('should return agent with populated pause fields after pause', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({
        id: 'agent-pause-1',
        name: 'Pausable Agent',
        tenantId: 'default',
      });

      // Pause the agent
      await store.pauseAgent('default', 'agent-pause-1', 'Error rate too high');

      const agent = await store.getAgent('agent-pause-1', 'default');
      expect(agent).toBeTruthy();
      expect(agent!.pausedAt).toBeDefined();
      expect(agent!.pauseReason).toBe('Error rate too high');
    });

    it('should return agent with model override after set', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({
        id: 'agent-model-1',
        name: 'Model Agent',
        tenantId: 'default',
      });

      await store.setModelOverride('default', 'agent-model-1', 'gpt-4o-mini');

      const agent = await store.getAgent('agent-model-1', 'default');
      expect(agent).toBeTruthy();
      expect(agent!.modelOverride).toBe('gpt-4o-mini');
    });
  });

  describe('Unpause endpoint', () => {
    it('PUT /api/agents/:id/unpause should clear pause state', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({
        id: 'agent-unpause-1',
        name: 'Unpausable Agent',
        tenantId: 'default',
      });

      // Pause the agent first
      await store.pauseAgent('default', 'agent-unpause-1', 'Guardrail triggered');

      // Unpause via API
      const res = await ctx.app.request('/api/agents/agent-unpause-1/unpause', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pausedAt).toBeFalsy();
      expect(body.pauseReason).toBeFalsy();
    });

    it('PUT /api/agents/:id/unpause should return 404 for non-existent agent', async () => {
      const res = await ctx.app.request('/api/agents/nonexistent/unpause', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it('PUT /api/agents/:id/unpause with clearModelOverride should also clear model override', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({
        id: 'agent-clear-all',
        name: 'Clear All Agent',
        tenantId: 'default',
      });

      // Pause and set model override
      await store.pauseAgent('default', 'agent-clear-all', 'Too many errors');
      await store.setModelOverride('default', 'agent-clear-all', 'gpt-4o-mini');

      // Unpause and clear model override
      const res = await ctx.app.request('/api/agents/agent-clear-all/unpause', {
        method: 'PUT',
        headers: authHeaders(ctx.apiKey),
        body: JSON.stringify({ clearModelOverride: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pausedAt).toBeFalsy();
      expect(body.pauseReason).toBeFalsy();
      expect(body.modelOverride).toBeFalsy();
    });

    it('PUT /api/agents/:id/unpause should require auth', async () => {
      const res = await ctx.app.request('/api/agents/agent-unpause-1/unpause', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('SqliteEventStore pause/unpause/setModelOverride', () => {
    it('pauseAgent should return true for existing agent', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({ id: 'a1', name: 'A1', tenantId: 'default' });
      const result = await store.pauseAgent('default', 'a1', 'Test reason');
      expect(result).toBe(true);
    });

    it('pauseAgent should return false for non-existent agent', async () => {
      const store = new SqliteEventStore(ctx.db);
      const result = await store.pauseAgent('default', 'nonexistent', 'Test');
      expect(result).toBe(false);
    });

    it('unpauseAgent should clear paused_at and pause_reason', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({ id: 'a2', name: 'A2', tenantId: 'default' });
      await store.pauseAgent('default', 'a2', 'Paused');
      await store.unpauseAgent('default', 'a2');

      const agent = await store.getAgent('a2', 'default');
      expect(agent!.pausedAt).toBeUndefined();
      expect(agent!.pauseReason).toBeUndefined();
    });

    it('unpauseAgent with clearModelOverride should also clear model_override', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({ id: 'a3', name: 'A3', tenantId: 'default' });
      await store.pauseAgent('default', 'a3', 'Paused');
      await store.setModelOverride('default', 'a3', 'gpt-4o-mini');
      await store.unpauseAgent('default', 'a3', true);

      const agent = await store.getAgent('a3', 'default');
      expect(agent!.pausedAt).toBeUndefined();
      expect(agent!.modelOverride).toBeUndefined();
    });

    it('setModelOverride should return true for existing agent', async () => {
      const store = new SqliteEventStore(ctx.db);
      await store.upsertAgent({ id: 'a4', name: 'A4', tenantId: 'default' });
      const result = await store.setModelOverride('default', 'a4', 'claude-3-haiku');
      expect(result).toBe(true);

      const agent = await store.getAgent('a4', 'default');
      expect(agent!.modelOverride).toBe('claude-3-haiku');
    });
  });
});
