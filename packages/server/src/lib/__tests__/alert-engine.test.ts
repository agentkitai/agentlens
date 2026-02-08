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
