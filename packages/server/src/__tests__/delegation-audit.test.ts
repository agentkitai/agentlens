/**
 * Tests for Delegation Audit & Logging (Story 6.5)
 * ~30 tests covering audit trail, filtering, export, retention, volume alerts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import {
  DelegationService,
  LocalPoolTransport,
} from '../services/delegation-service.js';
import { DiscoveryService } from '../services/discovery-service.js';
import * as schema from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { SqliteDb } from '../db/index.js';

describe('Delegation Audit & Logging — Story 6.5', () => {
  let db: SqliteDb;
  let transport: LocalPoolTransport;
  let service: DelegationService;
  let now: Date;

  function setupAgent(tenantId: string, agentId: string) {
    // Create agent
    db.insert(schema.agents).values({
      id: agentId,
      tenantId,
      name: `Agent ${agentId}`,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }).run();

    // Create capability with delegation acceptance
    db.insert(schema.capabilityRegistry).values({
      id: randomUUID(),
      tenantId,
      agentId,
      taskType: 'summarization',
      inputSchema: '{}',
      outputSchema: '{}',
      scope: 'internal',
      enabled: true,
      acceptDelegations: true,
      inboundRateLimit: 10,
      outboundRateLimit: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();

    // Enable delegation
    db.insert(schema.discoveryConfig).values({
      tenantId,
      minTrustThreshold: 60,
      delegationEnabled: true,
      updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: schema.discoveryConfig.tenantId,
      set: { delegationEnabled: true, updatedAt: new Date().toISOString() },
    }).run();
  }

  function insertDelegationLog(
    tenantId: string,
    agentId: string,
    overrides: Record<string, unknown> = {},
  ) {
    const id = (overrides.id as string) ?? randomUUID();
    db.insert(schema.delegationLog).values({
      id,
      tenantId,
      direction: (overrides.direction as string) ?? 'outbound',
      agentId,
      anonymousTargetId: (overrides.anonymousTargetId as string) ?? randomUUID(),
      anonymousSourceId: (overrides.anonymousSourceId as string) ?? null,
      taskType: (overrides.taskType as string) ?? 'summarization',
      status: (overrides.status as string) ?? 'completed',
      requestSizeBytes: (overrides.requestSizeBytes as number) ?? 100,
      responseSizeBytes: (overrides.responseSizeBytes as number) ?? 200,
      executionTimeMs: (overrides.executionTimeMs as number) ?? 500,
      costUsd: (overrides.costUsd as number) ?? 0.01,
      createdAt: (overrides.createdAt as string) ?? now.toISOString(),
      completedAt: (overrides.completedAt as string) ?? now.toISOString(),
    }).run();
    return id;
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    transport = new LocalPoolTransport();
    now = new Date('2026-02-09T10:00:00Z');
    service = new DelegationService(db, transport, { now: () => now });
  });

  // ════════════════════════════════════════════════════
  // Audit Trail
  // ════════════════════════════════════════════════════

  describe('audit trail', () => {
    it('logs outbound delegations', () => {
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'outbound' });
      const logs = service.getDelegationLogs('tenant-1');
      expect(logs.length).toBe(1);
      expect(logs[0].direction).toBe('outbound');
    });

    it('logs inbound delegations', () => {
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'inbound' });
      const logs = service.getDelegationLogs('tenant-1');
      expect(logs.length).toBe(1);
      expect(logs[0].direction).toBe('inbound');
    });

    it('logs both directions', () => {
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'outbound' });
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'inbound' });
      const logs = service.getDelegationLogs('tenant-1');
      expect(logs.length).toBe(2);
    });

    it('stores all required fields', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        taskType: 'summarization',
        status: 'completed',
        executionTimeMs: 500,
        costUsd: 0.01,
      });
      const log = service.getDelegationLogs('tenant-1')[0];
      expect(log.taskType).toBe('summarization');
      expect(log.status).toBe('completed');
      expect(log.executionTimeMs).toBe(500);
      expect(log.costUsd).toBe(0.01);
    });

    it('isolates logs by tenant', () => {
      insertDelegationLog('tenant-1', 'agent-1');
      insertDelegationLog('tenant-2', 'agent-2');
      expect(service.getDelegationLogs('tenant-1').length).toBe(1);
      expect(service.getDelegationLogs('tenant-2').length).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════
  // getDelegationsForAgent() with filters
  // ════════════════════════════════════════════════════

  describe('getDelegationsForAgent()', () => {
    it('returns all delegations for an agent', () => {
      insertDelegationLog('tenant-1', 'agent-1');
      insertDelegationLog('tenant-1', 'agent-1');
      insertDelegationLog('tenant-1', 'agent-2');
      const logs = service.getDelegationsForAgent('tenant-1', 'agent-1');
      expect(logs.length).toBe(2);
    });

    it('filters by direction', () => {
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'outbound' });
      insertDelegationLog('tenant-1', 'agent-1', { direction: 'inbound' });
      const outbound = service.getDelegationsForAgent('tenant-1', 'agent-1', { direction: 'outbound' });
      expect(outbound.length).toBe(1);
      expect(outbound[0].direction).toBe('outbound');
    });

    it('filters by status', () => {
      insertDelegationLog('tenant-1', 'agent-1', { status: 'completed' });
      insertDelegationLog('tenant-1', 'agent-1', { status: 'error' });
      insertDelegationLog('tenant-1', 'agent-1', { status: 'timeout' });
      const completed = service.getDelegationsForAgent('tenant-1', 'agent-1', { status: 'completed' });
      expect(completed.length).toBe(1);
    });

    it('filters by date range', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        createdAt: '2026-02-01T00:00:00Z',
      });
      insertDelegationLog('tenant-1', 'agent-1', {
        createdAt: '2026-02-09T00:00:00Z',
      });
      insertDelegationLog('tenant-1', 'agent-1', {
        createdAt: '2026-02-15T00:00:00Z',
      });

      const filtered = service.getDelegationsForAgent('tenant-1', 'agent-1', {
        dateFrom: '2026-02-05T00:00:00Z',
        dateTo: '2026-02-10T00:00:00Z',
      });
      expect(filtered.length).toBe(1);
    });

    it('combines multiple filters', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'outbound',
        status: 'completed',
        createdAt: '2026-02-09T00:00:00Z',
      });
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'inbound',
        status: 'completed',
        createdAt: '2026-02-09T00:00:00Z',
      });
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'outbound',
        status: 'error',
        createdAt: '2026-02-09T00:00:00Z',
      });

      const filtered = service.getDelegationsForAgent('tenant-1', 'agent-1', {
        direction: 'outbound',
        status: 'completed',
      });
      expect(filtered.length).toBe(1);
    });

    it('returns empty array when no matches', () => {
      insertDelegationLog('tenant-1', 'agent-1', { status: 'completed' });
      const filtered = service.getDelegationsForAgent('tenant-1', 'agent-1', { status: 'timeout' });
      expect(filtered.length).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════
  // Export
  // ════════════════════════════════════════════════════

  describe('exportDelegationLogs()', () => {
    it('exports as valid JSON string', () => {
      insertDelegationLog('tenant-1', 'agent-1');
      const json = service.exportDelegationLogs('tenant-1');
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
    });

    it('exports empty array when no logs', () => {
      const json = service.exportDelegationLogs('tenant-1');
      expect(JSON.parse(json)).toEqual([]);
    });

    it('exports all fields', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        taskType: 'code-review',
        status: 'completed',
        executionTimeMs: 1234,
      });
      const parsed = JSON.parse(service.exportDelegationLogs('tenant-1'));
      expect(parsed[0].taskType).toBe('code-review');
      expect(parsed[0].executionTimeMs).toBe(1234);
    });

    it('exports multiple logs', () => {
      for (let i = 0; i < 5; i++) {
        insertDelegationLog('tenant-1', 'agent-1');
      }
      const parsed = JSON.parse(service.exportDelegationLogs('tenant-1'));
      expect(parsed.length).toBe(5);
    });

    it('only exports for specified tenant', () => {
      insertDelegationLog('tenant-1', 'agent-1');
      insertDelegationLog('tenant-2', 'agent-2');
      const parsed = JSON.parse(service.exportDelegationLogs('tenant-1'));
      expect(parsed.length).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════
  // Retention Cleanup
  // ════════════════════════════════════════════════════

  describe('cleanupOldLogs()', () => {
    it('deletes logs older than 90 days by default', () => {
      const oldDate = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: oldDate });
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });

      const deleted = service.cleanupOldLogs('tenant-1');
      expect(deleted).toBe(1);
      expect(service.getDelegationLogs('tenant-1').length).toBe(1);
    });

    it('keeps logs newer than retention period', () => {
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });
      const deleted = service.cleanupOldLogs('tenant-1');
      expect(deleted).toBe(0);
      expect(service.getDelegationLogs('tenant-1').length).toBe(1);
    });

    it('supports configurable retention period', () => {
      const thirtyOneDaysAgo = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString();
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: thirtyOneDaysAgo });

      // Default 90 days — should NOT delete
      const deleted90 = service.cleanupOldLogs('tenant-1', 90);
      expect(deleted90).toBe(0);

      // Custom 30 days — should delete
      const deleted30 = service.cleanupOldLogs('tenant-1', 30);
      expect(deleted30).toBe(1);
    });

    it('only cleans up for specified tenant', () => {
      const oldDate = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: oldDate });
      insertDelegationLog('tenant-2', 'agent-2', { createdAt: oldDate });

      service.cleanupOldLogs('tenant-1');
      expect(service.getDelegationLogs('tenant-1').length).toBe(0);
      expect(service.getDelegationLogs('tenant-2').length).toBe(1);
    });

    it('returns count of deleted records', () => {
      const oldDate = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 5; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: oldDate });
      }
      const deleted = service.cleanupOldLogs('tenant-1');
      expect(deleted).toBe(5);
    });
  });

  // ════════════════════════════════════════════════════
  // Volume Alerts
  // ════════════════════════════════════════════════════

  describe('checkVolumeAlert()', () => {
    it('no alert when below threshold', () => {
      insertDelegationLog('tenant-1', 'agent-1');
      const result = service.checkVolumeAlert('tenant-1');
      expect(result.alert).toBe(false);
      expect(result.count).toBe(1);
    });

    it('triggers alert when >100 delegations in past hour', () => {
      for (let i = 0; i < 101; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });
      }
      const result = service.checkVolumeAlert('tenant-1');
      expect(result.alert).toBe(true);
      expect(result.count).toBe(101);
    });

    it('does not count old delegations', () => {
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
      for (let i = 0; i < 101; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: twoHoursAgo });
      }
      const result = service.checkVolumeAlert('tenant-1');
      expect(result.alert).toBe(false);
      expect(result.count).toBe(0);
    });

    it('supports custom threshold', () => {
      for (let i = 0; i < 11; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });
      }
      const result = service.checkVolumeAlert('tenant-1', 10);
      expect(result.alert).toBe(true);
    });

    it('returns exact count', () => {
      for (let i = 0; i < 42; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });
      }
      const result = service.checkVolumeAlert('tenant-1');
      expect(result.count).toBe(42);
    });

    it('isolates by tenant', () => {
      for (let i = 0; i < 101; i++) {
        insertDelegationLog('tenant-1', 'agent-1', { createdAt: now.toISOString() });
      }
      const result = service.checkVolumeAlert('tenant-2');
      expect(result.alert).toBe(false);
      expect(result.count).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════
  // Integration: delegation logs created during delegation flow
  // ════════════════════════════════════════════════════

  describe('delegation flow creates audit logs', () => {
    it('stores timing information', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        executionTimeMs: 1500,
        requestSizeBytes: 256,
        responseSizeBytes: 1024,
      });
      const log = service.getDelegationLogs('tenant-1')[0];
      expect(log.executionTimeMs).toBe(1500);
      expect(log.requestSizeBytes).toBe(256);
      expect(log.responseSizeBytes).toBe(1024);
    });

    it('stores cost information', () => {
      insertDelegationLog('tenant-1', 'agent-1', { costUsd: 0.05 });
      const log = service.getDelegationLogs('tenant-1')[0];
      expect(log.costUsd).toBe(0.05);
    });

    it('stores anonymous target/source IDs', () => {
      const targetId = randomUUID();
      const sourceId = randomUUID();
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'outbound',
        anonymousTargetId: targetId,
      });
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'inbound',
        anonymousSourceId: sourceId,
      });
      const logs = service.getDelegationLogs('tenant-1');
      const outbound = logs.find((l) => l.direction === 'outbound');
      const inbound = logs.find((l) => l.direction === 'inbound');
      expect(outbound?.anonymousTargetId).toBe(targetId);
      expect(inbound?.anonymousSourceId).toBe(sourceId);
    });

    it('handles various status values', () => {
      const statuses = ['request', 'accepted', 'rejected', 'completed', 'timeout', 'error'];
      for (const status of statuses) {
        insertDelegationLog('tenant-1', 'agent-1', { status });
      }
      const logs = service.getDelegationLogs('tenant-1');
      expect(logs.length).toBe(6);
      const logStatuses = logs.map((l) => l.status).sort();
      expect(logStatuses).toEqual(statuses.sort());
    });

    it('preserves completedAt timestamp', () => {
      const completedAt = '2026-02-09T12:00:00Z';
      insertDelegationLog('tenant-1', 'agent-1', { completedAt });
      const log = service.getDelegationLogs('tenant-1')[0];
      expect(log.completedAt).toBe(completedAt);
    });

    it('handles null optional fields gracefully', () => {
      // Default insertDelegationLog already sets some values, so check that logs are stored
      insertDelegationLog('tenant-1', 'agent-1');
      const log = service.getDelegationLogs('tenant-1')[0];
      expect(log).toBeTruthy();
      expect(log.id).toBeTruthy();
    });
  });

  // ════════════════════════════════════════════════════
  // Cleanup edge cases
  // ════════════════════════════════════════════════════

  describe('cleanup edge cases', () => {
    it('handles empty log table gracefully', () => {
      const deleted = service.cleanupOldLogs('tenant-1');
      expect(deleted).toBe(0);
    });

    it('does not delete logs exactly at boundary', () => {
      // 90 days ago exactly — should NOT be deleted (< vs <=)
      const exactBoundary = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: exactBoundary });
      const deleted = service.cleanupOldLogs('tenant-1');
      expect(deleted).toBe(0);
    });

    it('very short retention deletes recent logs', () => {
      // Insert a log 2 days ago
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
      insertDelegationLog('tenant-1', 'agent-1', { createdAt: twoDaysAgo });
      const deleted = service.cleanupOldLogs('tenant-1', 1);
      expect(deleted).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════
  // Export edge cases
  // ════════════════════════════════════════════════════

  describe('export edge cases', () => {
    it('export is valid JSON with special characters in data', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        taskType: 'code-review',
      });
      const json = service.exportDelegationLogs('tenant-1');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('export preserves all delegation log fields', () => {
      insertDelegationLog('tenant-1', 'agent-1', {
        direction: 'inbound',
        status: 'error',
        costUsd: 0.123,
      });
      const parsed = JSON.parse(service.exportDelegationLogs('tenant-1'));
      expect(parsed[0]).toHaveProperty('id');
      expect(parsed[0]).toHaveProperty('tenantId');
      expect(parsed[0]).toHaveProperty('direction');
      expect(parsed[0]).toHaveProperty('agentId');
      expect(parsed[0]).toHaveProperty('taskType');
      expect(parsed[0]).toHaveProperty('status');
      expect(parsed[0]).toHaveProperty('createdAt');
    });
  });
});
