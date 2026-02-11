/**
 * Tests for Alert Evaluation Engine (Story 12.2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ulid } from 'ulid';
import { createTestDb, type SqliteDb } from '../../db/index.js';
import { runMigrations } from '../../db/migrate.js';
import { SqliteEventStore } from '../../db/sqlite-store.js';
import { AlertEngine } from '../alert-engine.js';
import { eventBus } from '../event-bus.js';
import type { AlertRule, AgentLensEvent } from '@agentlensai/core';
import { computeEventHash } from '@agentlensai/core';

let db: SqliteDb;
let store: SqliteEventStore;
let engine: AlertEngine;

function makeEvent(
  overrides: Partial<AgentLensEvent> & { sessionId: string; agentId: string },
  prevHash: string | null = null,
): AgentLensEvent {
  const id = ulid();
  const base = {
    id,
    timestamp: new Date().toISOString(),
    sessionId: overrides.sessionId,
    agentId: overrides.agentId,
    eventType: overrides.eventType ?? ('tool_call' as const),
    severity: overrides.severity ?? ('info' as const),
    payload: overrides.payload ?? { toolName: 'test', callId: id, arguments: {} },
    metadata: overrides.metadata ?? {},
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

  return base as AgentLensEvent;
}

beforeEach(() => {
  db = createTestDb();
  runMigrations(db);
  store = new SqliteEventStore(db);
  engine = new AlertEngine(store, { checkIntervalMs: 60_000 });
});

afterEach(() => {
  engine.stop();
  eventBus.removeAllListeners();
});

describe('AlertEngine.evaluate()', () => {
  it('returns empty when no rules exist', async () => {
    const triggered = await engine.evaluate();
    expect(triggered).toEqual([]);
  });

  it('returns empty when rules are disabled', async () => {
    const now = new Date().toISOString();
    await store.createAlertRule({
      id: ulid(),
      name: 'Disabled Rule',
      enabled: false,
      condition: 'error_rate_exceeds',
      threshold: 0.01,
      windowMinutes: 60,
      scope: {},
      notifyChannels: [],
      createdAt: now,
      updatedAt: now,
      tenantId: 'default',
    });

    const triggered = await engine.evaluate();
    expect(triggered).toEqual([]);
  });

  it('triggers when error rate exceeds threshold', async () => {
    const now = new Date().toISOString();

    // Create rule
    await store.createAlertRule({
      id: ulid(),
      name: 'Error Rate Alert',
      enabled: true,
      condition: 'error_rate_exceeds',
      threshold: 0.1, // 10%
      windowMinutes: 60,
      scope: {},
      notifyChannels: [],
      createdAt: now,
      updatedAt: now,
      tenantId: 'default',
    });

    // Insert events as a single batch: 1 start + 8 normal + 2 errors = ~18% error rate
    const sessionId = 'test-session';
    const agentId = 'test-agent';
    const batch: AgentLensEvent[] = [];

    const startEvent = makeEvent(
      { sessionId, agentId, eventType: 'session_started', payload: { agentName: 'test' } },
      null,
    );
    batch.push(startEvent);
    let prevHash = startEvent.hash;

    for (let i = 0; i < 8; i++) {
      const ev = makeEvent({ sessionId, agentId }, prevHash);
      batch.push(ev);
      prevHash = ev.hash;
    }

    // Error events
    for (let i = 0; i < 2; i++) {
      const ev = makeEvent(
        { sessionId, agentId, eventType: 'tool_error', severity: 'error', payload: { toolName: 'test', callId: ulid(), error: 'fail', durationMs: 100 } },
        prevHash,
      );
      batch.push(ev);
      prevHash = ev.hash;
    }

    await store.insertEvents(batch);

    // Track EventBus emission
    const emitted: unknown[] = [];
    eventBus.on('alert_triggered', (ev) => emitted.push(ev));

    const triggered = await engine.evaluate();
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.message).toContain('Error rate');
    expect(emitted).toHaveLength(1);

    // Verify it was persisted in history
    const history = await store.listAlertHistory();
    expect(history.entries).toHaveLength(1);
  });

  it('does not trigger when below threshold', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(),
      name: 'Error Rate Alert',
      enabled: true,
      condition: 'error_rate_exceeds',
      threshold: 0.5, // 50% — very high
      windowMinutes: 60,
      scope: {},
      notifyChannels: [],
      createdAt: now,
      updatedAt: now,
      tenantId: 'default',
    });

    // Insert events as a single batch to avoid hash chain issues
    const sessionId = 'test-session';
    const agentId = 'test-agent';
    const batch: AgentLensEvent[] = [];

    const startEvent = makeEvent(
      { sessionId, agentId, eventType: 'session_started', payload: { agentName: 'test' } },
      null,
    );
    batch.push(startEvent);
    let prevHash = startEvent.hash;

    for (let i = 0; i < 9; i++) {
      const ev = makeEvent({ sessionId, agentId }, prevHash);
      batch.push(ev);
      prevHash = ev.hash;
    }

    const errEv = makeEvent(
      { sessionId, agentId, eventType: 'tool_error', severity: 'error', payload: { toolName: 'test', callId: ulid(), error: 'fail', durationMs: 100 } },
      prevHash,
    );
    batch.push(errEv);

    await store.insertEvents(batch);

    const triggered = await engine.evaluate();
    expect(triggered).toEqual([]);
  });

  it('triggers event_count_exceeds rule', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(),
      name: 'Event Count Alert',
      enabled: true,
      condition: 'event_count_exceeds',
      threshold: 3,
      windowMinutes: 60,
      scope: {},
      notifyChannels: [],
      createdAt: now,
      updatedAt: now,
      tenantId: 'default',
    });

    // Insert 5 events as a batch (>3 threshold)
    const sessionId = 'test-session';
    const agentId = 'test-agent';
    const batch: AgentLensEvent[] = [];

    const startEvent = makeEvent(
      { sessionId, agentId, eventType: 'session_started', payload: { agentName: 'test' } },
      null,
    );
    batch.push(startEvent);
    let prevHash = startEvent.hash;

    for (let i = 0; i < 4; i++) {
      const ev = makeEvent({ sessionId, agentId }, prevHash);
      batch.push(ev);
      prevHash = ev.hash;
    }

    await store.insertEvents(batch);

    const triggered = await engine.evaluate();
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.message).toContain('Event count');
  });

  it('triggers no_events_for when no events exist', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(),
      name: 'No Events Alert',
      enabled: true,
      condition: 'no_events_for',
      threshold: 0,
      windowMinutes: 5,
      scope: {},
      notifyChannels: [],
      createdAt: now,
      updatedAt: now,
      tenantId: 'default',
    });

    // No events inserted
    const triggered = await engine.evaluate();
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.message).toContain('No events');
  });
});

describe('AlertEngine lifecycle', () => {
  it('can start and stop', () => {
    engine.start();
    // Starting twice is a no-op
    engine.start();
    engine.stop();
    engine.stop(); // Stopping twice is safe
  });
});

describe('AlertEngine analytics cache (S-2.2)', () => {
  it('computes analytics once for rules sharing the same agent and window', async () => {
    const now = new Date().toISOString();
    const agentId = 'shared-agent';

    // Two rules with the same scope and window
    await store.createAlertRule({
      id: ulid(), name: 'Rule A', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 60, scope: { agentId },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });
    await store.createAlertRule({
      id: ulid(), name: 'Rule B', enabled: true,
      condition: 'error_rate_exceeds', threshold: 0.99,
      windowMinutes: 60, scope: { agentId },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');

    // We need a TenantScopedStore spy too — the engine wraps the store
    // But since both rules share the same key, only 1 call should happen
    // through the tenant-scoped wrapper. We spy on the underlying store.
    await engine.evaluate();

    // Should be called exactly once (both rules share tenantId:agentId:windowMinutes)
    expect(getAnalyticsSpy).toHaveBeenCalledTimes(1);
    getAnalyticsSpy.mockRestore();
  });

  it('computes analytics separately for different agents', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(), name: 'Agent1 Rule', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 60, scope: { agentId: 'agent-1' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });
    await store.createAlertRule({
      id: ulid(), name: 'Agent2 Rule', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 60, scope: { agentId: 'agent-2' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');
    await engine.evaluate();

    expect(getAnalyticsSpy).toHaveBeenCalledTimes(2);
    getAnalyticsSpy.mockRestore();
  });

  it('computes analytics separately for different window sizes', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(), name: '60m Rule', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 60, scope: { agentId: 'same-agent' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });
    await store.createAlertRule({
      id: ulid(), name: '30m Rule', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 30, scope: { agentId: 'same-agent' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');
    await engine.evaluate();

    expect(getAnalyticsSpy).toHaveBeenCalledTimes(2);
    getAnalyticsSpy.mockRestore();
  });

  it('clears cache after evaluation cycle', async () => {
    const now = new Date().toISOString();

    await store.createAlertRule({
      id: ulid(), name: 'Cached Rule', enabled: true,
      condition: 'event_count_exceeds', threshold: 1000,
      windowMinutes: 60, scope: { agentId: 'cache-agent' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');

    // First cycle
    await engine.evaluate();
    expect(getAnalyticsSpy).toHaveBeenCalledTimes(1);

    // Second cycle — cache should have been cleared, so analytics is called again
    await engine.evaluate();
    expect(getAnalyticsSpy).toHaveBeenCalledTimes(2);

    getAnalyticsSpy.mockRestore();
  });

  it('groups rules correctly: 3 rules, 2 unique keys → 2 analytics calls', async () => {
    const now = new Date().toISOString();

    // Two rules share the same key
    for (const name of ['R1', 'R2']) {
      await store.createAlertRule({
        id: ulid(), name, enabled: true,
        condition: 'error_rate_exceeds', threshold: 0.99,
        windowMinutes: 60, scope: { agentId: 'agentA' },
        notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
      });
    }
    // Third rule has a different key
    await store.createAlertRule({
      id: ulid(), name: 'R3', enabled: true,
      condition: 'cost_exceeds', threshold: 9999,
      windowMinutes: 120, scope: { agentId: 'agentA' },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');
    await engine.evaluate();

    expect(getAnalyticsSpy).toHaveBeenCalledTimes(2);
    getAnalyticsSpy.mockRestore();
  });

  it('shares cached analytics results correctly across rules', async () => {
    const now = new Date().toISOString();
    const sessionId = 'cache-session';
    const agentId = 'cache-share-agent';

    // Insert events: 5 events total (exceeds threshold of 3)
    const batch: AgentLensEvent[] = [];
    const startEvent = makeEvent(
      { sessionId, agentId, eventType: 'session_started', payload: { agentName: 'test' } },
      null,
    );
    batch.push(startEvent);
    let prevHash = startEvent.hash;
    for (let i = 0; i < 4; i++) {
      const ev = makeEvent({ sessionId, agentId }, prevHash);
      batch.push(ev);
      prevHash = ev.hash;
    }
    await store.insertEvents(batch);

    // Two rules, same scope/window, different thresholds
    await store.createAlertRule({
      id: ulid(), name: 'Low Threshold', enabled: true,
      condition: 'event_count_exceeds', threshold: 3,
      windowMinutes: 60, scope: { agentId },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });
    await store.createAlertRule({
      id: ulid(), name: 'High Threshold', enabled: true,
      condition: 'event_count_exceeds', threshold: 100,
      windowMinutes: 60, scope: { agentId },
      notifyChannels: [], createdAt: now, updatedAt: now, tenantId: 'default',
    });

    const getAnalyticsSpy = vi.spyOn(store, 'getAnalytics');
    const triggered = await engine.evaluate();

    // Only 1 analytics call despite 2 rules
    expect(getAnalyticsSpy).toHaveBeenCalledTimes(1);
    // Only the low-threshold rule triggers
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.message).toContain('Event count');

    getAnalyticsSpy.mockRestore();
  });
});

describe('AlertEngine configurable interval (S-2.2)', () => {
  it('uses ALERT_CHECK_INTERVAL_MS env var', () => {
    const original = process.env['ALERT_CHECK_INTERVAL_MS'];
    try {
      process.env['ALERT_CHECK_INTERVAL_MS'] = '5000';
      const customEngine = new AlertEngine(store);
      // Access private field via cast
      expect((customEngine as any).checkIntervalMs).toBe(5000);
    } finally {
      if (original === undefined) {
        delete process.env['ALERT_CHECK_INTERVAL_MS'];
      } else {
        process.env['ALERT_CHECK_INTERVAL_MS'] = original;
      }
    }
  });

  it('defaults to 60000 when env var is not set', () => {
    const original = process.env['ALERT_CHECK_INTERVAL_MS'];
    try {
      delete process.env['ALERT_CHECK_INTERVAL_MS'];
      const customEngine = new AlertEngine(store);
      expect((customEngine as any).checkIntervalMs).toBe(60000);
    } finally {
      if (original !== undefined) {
        process.env['ALERT_CHECK_INTERVAL_MS'] = original;
      }
    }
  });
});
