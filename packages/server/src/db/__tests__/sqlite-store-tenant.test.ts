/**
 * Comprehensive Tenant Isolation Tests (Story 1.3)
 *
 * These tests verify that tenants CANNOT access each other's data.
 * This is SECURITY-CRITICAL — every data path must be tested.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../index.js';
import { runMigrations } from '../migrate.js';
import { SqliteEventStore } from '../sqlite-store.js';
import { TenantScopedStore } from '../tenant-scoped-store.js';
import { computeEventHash } from '@agentlensai/core';
import type { AgentLensEvent, AlertRule } from '@agentlensai/core';

// ─── Helpers ─────────────────────────────────────────────────────

function makeEvent(overrides: Partial<AgentLensEvent> & { sessionId: string; agentId: string }): AgentLensEvent {
  const base = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    eventType: 'tool_call' as const,
    severity: 'info' as const,
    payload: { toolName: 'test', arguments: {}, callId: 'c1' },
    metadata: {},
    prevHash: null,
    hash: '',
    tenantId: 'default',
    ...overrides,
  };
  base.hash = computeEventHash({
    id: base.id,
    timestamp: base.timestamp,
    sessionId: base.sessionId,
    agentId: base.agentId,
    eventType: base.eventType,
    severity: base.severity,
    payload: base.payload,
    metadata: base.metadata,
    prevHash: base.prevHash,
  });
  return base;
}

function makeSessionStartEvent(sessionId: string, agentId: string, prevHash: string | null = null): AgentLensEvent {
  const base: AgentLensEvent = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    sessionId,
    agentId,
    eventType: 'session_started',
    severity: 'info',
    payload: { agentName: agentId, tags: [] },
    metadata: {},
    prevHash,
    hash: '',
    tenantId: 'default',
  };
  base.hash = computeEventHash({
    id: base.id,
    timestamp: base.timestamp,
    sessionId: base.sessionId,
    agentId: base.agentId,
    eventType: base.eventType,
    severity: base.severity,
    payload: base.payload,
    metadata: base.metadata,
    prevHash: base.prevHash,
  });
  return base;
}

// ─── Tests ───────────────────────────────────────────────────────

describe('Tenant Isolation (Story 1.3)', () => {
  let store: SqliteEventStore;
  let tenantA: TenantScopedStore;
  let tenantB: TenantScopedStore;

  beforeEach(() => {
    const db = createTestDb();
    runMigrations(db);
    store = new SqliteEventStore(db);
    tenantA = new TenantScopedStore(store, 'tenant-a');
    tenantB = new TenantScopedStore(store, 'tenant-b');
  });

  // ─── Event Isolation ───────────────────────────────────────

  describe('Event Isolation', () => {
    it('tenant A cannot see tenant B events via queryEvents', async () => {
      const evA = makeSessionStartEvent('sess-a', 'agent-a');
      const evB = makeSessionStartEvent('sess-b', 'agent-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const resultA = await tenantA.queryEvents({});
      const resultB = await tenantB.queryEvents({});

      expect(resultA.events).toHaveLength(1);
      expect(resultA.events[0]!.id).toBe(evA.id);
      expect(resultA.events[0]!.tenantId).toBe('tenant-a');

      expect(resultB.events).toHaveLength(1);
      expect(resultB.events[0]!.id).toBe(evB.id);
      expect(resultB.events[0]!.tenantId).toBe('tenant-b');
    });

    it('tenant A cannot get tenant B event by ID', async () => {
      const evB = makeSessionStartEvent('sess-b', 'agent-b');
      await tenantB.insertEvents([evB]);

      const result = await tenantA.getEvent(evB.id);
      expect(result).toBeNull();

      // But tenant B can
      const resultB = await tenantB.getEvent(evB.id);
      expect(resultB).not.toBeNull();
      expect(resultB!.id).toBe(evB.id);
    });

    it('countEvents is tenant-scoped', async () => {
      const evA1 = makeSessionStartEvent('sess-a1', 'agent-a');
      const evA2 = makeEvent({ sessionId: 'sess-a1', agentId: 'agent-a', prevHash: evA1.hash });
      const evB1 = makeSessionStartEvent('sess-b1', 'agent-b');

      await tenantA.insertEvents([evA1]);
      await tenantA.insertEvents([evA2]);
      await tenantB.insertEvents([evB1]);

      expect(await tenantA.countEvents({})).toBe(2);
      expect(await tenantB.countEvents({})).toBe(1);
    });

    it('getSessionTimeline is tenant-scoped', async () => {
      // Both tenants use the same session ID (but different tenants)
      const evA = makeSessionStartEvent('shared-sess', 'agent-a');
      const evB = makeSessionStartEvent('shared-sess', 'agent-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const timelineA = await tenantA.getSessionTimeline('shared-sess');
      const timelineB = await tenantB.getSessionTimeline('shared-sess');

      expect(timelineA).toHaveLength(1);
      expect(timelineA[0]!.tenantId).toBe('tenant-a');

      expect(timelineB).toHaveLength(1);
      expect(timelineB[0]!.tenantId).toBe('tenant-b');
    });

    it('getLastEventHash is tenant-scoped', async () => {
      const evA = makeSessionStartEvent('shared-sess', 'agent-a');
      const evB = makeSessionStartEvent('shared-sess', 'agent-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const hashA = await tenantA.getLastEventHash('shared-sess');
      const hashB = await tenantB.getLastEventHash('shared-sess');

      expect(hashA).toBe(evA.hash);
      expect(hashB).toBe(evB.hash);
      expect(hashA).not.toBe(hashB);
    });
  });

  // ─── Session Isolation ─────────────────────────────────────

  describe('Session Isolation', () => {
    it('tenant A cannot see tenant B sessions via querySessions', async () => {
      const evA = makeSessionStartEvent('sess-a', 'agent-a');
      const evB = makeSessionStartEvent('sess-b', 'agent-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const resultA = await tenantA.querySessions({});
      const resultB = await tenantB.querySessions({});

      expect(resultA.sessions).toHaveLength(1);
      expect(resultA.sessions[0]!.id).toBe('sess-a');
      expect(resultA.sessions[0]!.tenantId).toBe('tenant-a');

      expect(resultB.sessions).toHaveLength(1);
      expect(resultB.sessions[0]!.id).toBe('sess-b');
      expect(resultB.sessions[0]!.tenantId).toBe('tenant-b');
    });

    it('tenant A cannot get tenant B session by ID', async () => {
      const evB = makeSessionStartEvent('sess-b', 'agent-b');
      await tenantB.insertEvents([evB]);

      const result = await tenantA.getSession('sess-b');
      expect(result).toBeNull();

      const resultB = await tenantB.getSession('sess-b');
      expect(resultB).not.toBeNull();
    });

    it('session totals are tenant-scoped', async () => {
      const evA = await tenantA.querySessions({});
      expect(evA.total).toBe(0);

      const ev1 = makeSessionStartEvent('sess-a1', 'agent-a');
      const ev2 = makeSessionStartEvent('sess-a2', 'agent-a');
      await tenantA.insertEvents([ev1]);
      await tenantA.insertEvents([ev2]);

      const ev3 = makeSessionStartEvent('sess-b1', 'agent-b');
      await tenantB.insertEvents([ev3]);

      const resultA = await tenantA.querySessions({});
      const resultB = await tenantB.querySessions({});

      expect(resultA.total).toBe(2);
      expect(resultB.total).toBe(1);
    });
  });

  // ─── Agent Isolation ───────────────────────────────────────

  describe('Agent Isolation', () => {
    it('tenant A cannot see tenant B agents via listAgents', async () => {
      const evA = makeSessionStartEvent('sess-a', 'agent-shared-id');
      const evB = makeSessionStartEvent('sess-b', 'agent-shared-id');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const agentsA = await tenantA.listAgents();
      const agentsB = await tenantB.listAgents();

      // After Batch A composite PK fix, each tenant gets their own agent record
      // even when they share the same agentId. Both tenants should see exactly 1 agent.
      expect(agentsA).toHaveLength(1);
      expect(agentsA[0]!.tenantId).toBe('tenant-a');

      expect(agentsB).toHaveLength(1);
      expect(agentsB[0]!.tenantId).toBe('tenant-b');
    });

    it('listAgents returns only the correct tenants agents', async () => {
      const evA = makeSessionStartEvent('sess-a', 'agent-only-a');
      const evB = makeSessionStartEvent('sess-b', 'agent-only-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const agentsA = await tenantA.listAgents();
      const agentsB = await tenantB.listAgents();

      expect(agentsA).toHaveLength(1);
      expect(agentsA[0]!.id).toBe('agent-only-a');

      expect(agentsB).toHaveLength(1);
      expect(agentsB[0]!.id).toBe('agent-only-b');
    });

    it('getAgent is tenant-scoped', async () => {
      const evA = makeSessionStartEvent('sess-a', 'agent-x');
      await tenantA.insertEvents([evA]);

      const agentA = await tenantA.getAgent('agent-x');
      const agentB = await tenantB.getAgent('agent-x');

      expect(agentA).not.toBeNull();
      expect(agentA!.tenantId).toBe('tenant-a');
      expect(agentB).toBeNull();
    });
  });

  // ─── Stats Isolation ───────────────────────────────────────

  describe('Stats Isolation', () => {
    it('getStats returns tenant-scoped counts', async () => {
      const ev1 = makeSessionStartEvent('sess-a', 'agent-a');
      const ev2 = makeEvent({ sessionId: 'sess-a', agentId: 'agent-a', prevHash: ev1.hash });
      const ev3 = makeSessionStartEvent('sess-b', 'agent-b');

      await tenantA.insertEvents([ev1]);
      await tenantA.insertEvents([ev2]);
      await tenantB.insertEvents([ev3]);

      const statsA = await tenantA.getStats();
      const statsB = await tenantB.getStats();

      expect(statsA.totalEvents).toBe(2);
      expect(statsA.totalSessions).toBe(1);

      expect(statsB.totalEvents).toBe(1);
      expect(statsB.totalSessions).toBe(1);
    });
  });

  // ─── Analytics Isolation ───────────────────────────────────

  describe('Analytics Isolation', () => {
    it('getAnalytics returns tenant-scoped metrics', async () => {
      const now = new Date();
      const from = new Date(now.getTime() - 3600_000).toISOString();
      const to = new Date(now.getTime() + 3600_000).toISOString();

      const evA = makeSessionStartEvent('sess-a', 'agent-a');
      const evB = makeSessionStartEvent('sess-b', 'agent-b');

      await tenantA.insertEvents([evA]);
      await tenantB.insertEvents([evB]);

      const analyticsA = await tenantA.getAnalytics({ from, to, granularity: 'hour' });
      const analyticsB = await tenantB.getAnalytics({ from, to, granularity: 'hour' });

      expect(analyticsA.totals.eventCount).toBe(1);
      expect(analyticsB.totals.eventCount).toBe(1);
      expect(analyticsA.totals.uniqueSessions).toBe(1);
    });
  });

  // ─── Alert Rule Isolation ──────────────────────────────────

  describe('Alert Rule Isolation', () => {
    it('tenant A cannot see tenant B alert rules', async () => {
      const ruleA: AlertRule = {
        id: 'rule-a',
        tenantId: 'default',
        name: 'Tenant A Rule',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const ruleB: AlertRule = {
        id: 'rule-b',
        name: 'Tenant B Rule',
        enabled: true,
        condition: 'cost_exceeds',
        threshold: 10,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      };

      await tenantA.createAlertRule(ruleA);
      await tenantB.createAlertRule(ruleB);

      const rulesA = await tenantA.listAlertRules();
      const rulesB = await tenantB.listAlertRules();

      expect(rulesA).toHaveLength(1);
      expect(rulesA[0]!.name).toBe('Tenant A Rule');

      expect(rulesB).toHaveLength(1);
      expect(rulesB[0]!.name).toBe('Tenant B Rule');
    });

    it('tenant A cannot get tenant B alert rule by ID', async () => {
      const rule: AlertRule = {
        id: 'rule-b-only',
        name: 'B Only',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      };

      await tenantB.createAlertRule(rule);

      const resultA = await tenantA.getAlertRule('rule-b-only');
      expect(resultA).toBeNull();

      const resultB = await tenantB.getAlertRule('rule-b-only');
      expect(resultB).not.toBeNull();
    });

    it('tenant A cannot update tenant B alert rule', async () => {
      const rule: AlertRule = {
        id: 'rule-b-update',
        name: 'B Update',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      };

      await tenantB.createAlertRule(rule);

      await expect(
        tenantA.updateAlertRule('rule-b-update', { name: 'Hacked' }),
      ).rejects.toThrow();

      // Verify not changed
      const result = await tenantB.getAlertRule('rule-b-update');
      expect(result!.name).toBe('B Update');
    });

    it('tenant A cannot delete tenant B alert rule', async () => {
      const rule: AlertRule = {
        id: 'rule-b-delete',
        name: 'B Delete',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      };

      await tenantB.createAlertRule(rule);

      await expect(
        tenantA.deleteAlertRule('rule-b-delete'),
      ).rejects.toThrow();

      // Verify still exists
      const result = await tenantB.getAlertRule('rule-b-delete');
      expect(result).not.toBeNull();
    });
  });

  // ─── Alert History Isolation ───────────────────────────────

  describe('Alert History Isolation', () => {
    it('tenant A cannot see tenant B alert history', async () => {
      // Must create alert rules first (FK constraint)
      const ruleA: AlertRule = {
        id: 'rule-hist-a',
        tenantId: 'default',
        name: 'Rule for Hist A',
        enabled: true,
        condition: 'error_rate_exceeds',
        threshold: 0.1,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const ruleB: AlertRule = {
        id: 'rule-hist-b',
        name: 'Rule for Hist B',
        enabled: true,
        condition: 'cost_exceeds',
        threshold: 10,
        windowMinutes: 60,
        scope: {},
        notifyChannels: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tenantId: 'default',
      };

      await tenantA.createAlertRule(ruleA);
      await tenantB.createAlertRule(ruleB);

      await tenantA.insertAlertHistory({
        id: 'hist-a',
        ruleId: 'rule-hist-a',
        triggeredAt: new Date().toISOString(),
        currentValue: 0.2,
        threshold: 0.1,
        message: 'Tenant A alert',
        tenantId: 'default',
      });

      await tenantB.insertAlertHistory({
        id: 'hist-b',
        ruleId: 'rule-hist-b',
        triggeredAt: new Date().toISOString(),
        currentValue: 15,
        threshold: 10,
        message: 'Tenant B alert',
        tenantId: 'default',
      });

      const histA = await tenantA.listAlertHistory({});
      const histB = await tenantB.listAlertHistory({});

      expect(histA.entries).toHaveLength(1);
      expect(histA.entries[0]!.id).toBe('hist-a');

      expect(histB.entries).toHaveLength(1);
      expect(histB.entries[0]!.id).toBe('hist-b');
    });
  });

  // ─── Cross-Tenant Safety ──────────────────────────────────

  describe('Cross-Tenant Safety', () => {
    it('inserting events stamps them with the correct tenant', async () => {
      const ev = makeSessionStartEvent('sess-x', 'agent-x');
      await tenantA.insertEvents([ev]);

      // Query directly from raw store to verify stamp
      const result = await store.queryEvents({ tenantId: 'tenant-a' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.tenantId).toBe('tenant-a');

      // Querying with wrong tenant yields nothing
      const wrongTenant = await store.queryEvents({ tenantId: 'tenant-b' });
      expect(wrongTenant.events).toHaveLength(0);
    });

    it('default tenant is used when no tenant specified on raw store', async () => {
      const ev = makeSessionStartEvent('sess-default', 'agent-default');
      // Insert directly on raw store (no tenant wrapper) — should get 'default'
      await store.insertEvents([ev]);

      const result = await store.queryEvents({ tenantId: 'default' });
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.tenantId).toBe('default');
    });

    it('many tenants can coexist without data leakage', async () => {
      const tenants = ['t1', 't2', 't3', 't4', 't5'];
      const stores = tenants.map(t => new TenantScopedStore(store, t));

      // Each tenant creates 3 events in a single batch (proper hash chain)
      for (let i = 0; i < stores.length; i++) {
        const s = stores[i]!;
        const sessionId = `sess-${tenants[i]}`;
        const agentId = `agent-${tenants[i]}`;

        const ev1 = makeSessionStartEvent(sessionId, agentId);
        const ev2 = makeEvent({ sessionId, agentId, prevHash: ev1.hash });
        const ev3 = makeEvent({
          sessionId,
          agentId,
          prevHash: ev2.hash,
          id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
        // Insert as a single batch to maintain hash chain integrity
        await s.insertEvents([ev1, ev2, ev3]);
      }

      // Each tenant sees exactly 3 events
      for (let i = 0; i < stores.length; i++) {
        const result = await stores[i]!.queryEvents({});
        expect(result.total).toBe(3);
        expect(result.events.every(e => e.tenantId === tenants[i])).toBe(true);
      }

      // Each tenant sees exactly 1 session
      for (let i = 0; i < stores.length; i++) {
        const result = await stores[i]!.querySessions({});
        expect(result.total).toBe(1);
      }

      // Each tenant sees exactly 1 agent
      for (let i = 0; i < stores.length; i++) {
        const agents = await stores[i]!.listAgents();
        expect(agents).toHaveLength(1);
        expect(agents[0]!.id).toBe(`agent-${tenants[i]}`);
      }
    });
  });
});
