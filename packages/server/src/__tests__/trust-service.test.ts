/**
 * Tests for TrustService — Story 6.3 (Trust Scoring)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore } from '../db/capability-store.js';
import { HealthSnapshotStore } from '../db/health-snapshot-store.js';
import { DiscoveryService } from '../services/discovery-service.js';
import { TrustService } from '../services/trust-service.js';
import { delegationLog } from '../db/schema.sqlite.js';
import type { SqliteDb } from '../db/index.js';
import type { HealthSnapshot } from '@agentlensai/core';

describe('TrustService — Story 6.3 (Trust Scoring)', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let healthStore: HealthSnapshotStore;
  let trustService: TrustService;
  let discoveryService: DiscoveryService;

  const baseCap = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  function insertDelegationLog(
    agentId: string,
    status: string,
    direction = 'outbound',
    tenantId = 'tenant-1',
  ) {
    const id = `del-${Math.random().toString(36).slice(2, 10)}`;
    db.insert(delegationLog).values({
      id,
      tenantId,
      direction,
      agentId,
      taskType: 'translation',
      status,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }).run();
  }

  function insertHealthSnapshot(agentId: string, date: string, score: number) {
    healthStore.save('tenant-1', {
      agentId,
      date,
      overallScore: score,
      errorRateScore: score,
      costEfficiencyScore: score,
      toolSuccessScore: score,
      latencyScore: score,
      completionRateScore: score,
      sessionCount: 10,
    });
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    healthStore = new HealthSnapshotStore(db);
    discoveryService = new DiscoveryService(db);
    trustService = new TrustService(db);
  });

  // ─── computeRawTrustScore ─────────────────────────────

  describe('computeRawTrustScore', () => {
    it('should return default score (50) when no data exists', () => {
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      // 0.6 * 50 + 0.4 * 50 = 50
      expect(score).toBe(50);
    });

    it('should use health scores when available', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 80);
      insertHealthSnapshot('agent-1', '2026-02-07', 60);
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      // health = (80+60)/2 = 70, delegation = 50 (default)
      // 0.6 * 70 + 0.4 * 50 = 42 + 20 = 62
      expect(score).toBe(62);
    });

    it('should use delegation success rate when available', () => {
      // 8 completed, 2 errors = 80% success rate
      for (let i = 0; i < 8; i++) insertDelegationLog('agent-1', 'completed');
      for (let i = 0; i < 2; i++) insertDelegationLog('agent-1', 'error');
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      // health = 50 (default), delegation = 80
      // 0.6 * 50 + 0.4 * 80 = 30 + 32 = 62
      expect(score).toBe(62);
    });

    it('should combine health and delegation components', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 90);
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'completed');
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      // health = 90, delegation = 100
      // 0.6 * 90 + 0.4 * 100 = 54 + 40 = 94
      expect(score).toBe(94);
    });

    it('should handle 0% delegation success rate', () => {
      for (let i = 0; i < 5; i++) insertDelegationLog('agent-1', 'error');
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      // health = 50, delegation = 0
      // 0.6 * 50 + 0.4 * 0 = 30
      expect(score).toBe(30);
    });

    it('should handle perfect health and delegation scores', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 100);
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'completed');
      const score = trustService.computeRawTrustScore('tenant-1', 'agent-1');
      expect(score).toBe(100);
    });

    it('should only count terminal delegation statuses', () => {
      // 'request' status should not be counted
      insertDelegationLog('agent-1', 'completed');
      insertDelegationLog('agent-1', 'request'); // not terminal
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.total).toBe(1);
    });

    it('should only count outbound delegations', () => {
      insertDelegationLog('agent-1', 'completed', 'outbound');
      insertDelegationLog('agent-1', 'completed', 'inbound');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.total).toBe(1);
    });
  });

  // ─── computeHealthComponent ───────────────────────────

  describe('computeHealthComponent', () => {
    it('should return 50 when no health data exists', () => {
      const component = trustService.computeHealthComponent('tenant-1', 'agent-1');
      expect(component).toBe(50);
    });

    it('should average health scores over last 30 days', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 80);
      insertHealthSnapshot('agent-1', '2026-02-07', 60);
      insertHealthSnapshot('agent-1', '2026-02-06', 70);
      const component = trustService.computeHealthComponent('tenant-1', 'agent-1');
      expect(component).toBe(70);
    });

    it('should handle single health snapshot', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 85);
      const component = trustService.computeHealthComponent('tenant-1', 'agent-1');
      expect(component).toBe(85);
    });
  });

  // ─── computeDelegationComponent ───────────────────────

  describe('computeDelegationComponent', () => {
    it('should return 50 when no delegations', () => {
      const component = trustService.computeDelegationComponent({ total: 0, successful: 0, failed: 0, timedOut: 0 });
      expect(component).toBe(50);
    });

    it('should compute 100% for all successful', () => {
      const component = trustService.computeDelegationComponent({ total: 10, successful: 10, failed: 0, timedOut: 0 });
      expect(component).toBe(100);
    });

    it('should compute 0% for all failed', () => {
      const component = trustService.computeDelegationComponent({ total: 10, successful: 0, failed: 10, timedOut: 0 });
      expect(component).toBe(0);
    });

    it('should compute mixed success rate', () => {
      const component = trustService.computeDelegationComponent({ total: 10, successful: 7, failed: 2, timedOut: 1 });
      expect(component).toBe(70);
    });
  });

  // ─── getDelegationStats ───────────────────────────────

  describe('getDelegationStats', () => {
    it('should return zero stats when no delegations', () => {
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats).toEqual({ total: 0, successful: 0, failed: 0, timedOut: 0 });
    });

    it('should count completed delegations', () => {
      for (let i = 0; i < 5; i++) insertDelegationLog('agent-1', 'completed');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.successful).toBe(5);
      expect(stats.total).toBe(5);
    });

    it('should count timed out delegations', () => {
      for (let i = 0; i < 3; i++) insertDelegationLog('agent-1', 'timeout');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.timedOut).toBe(3);
      expect(stats.total).toBe(3);
    });

    it('should count error and rejected as failed', () => {
      insertDelegationLog('agent-1', 'error');
      insertDelegationLog('agent-1', 'rejected');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.failed).toBe(2);
    });

    it('should isolate by tenant', () => {
      insertDelegationLog('agent-1', 'completed', 'outbound', 'tenant-1');
      insertDelegationLog('agent-1', 'completed', 'outbound', 'tenant-2');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.total).toBe(1);
    });

    it('should isolate by agent', () => {
      insertDelegationLog('agent-1', 'completed');
      insertDelegationLog('agent-2', 'completed');
      const stats = trustService.getDelegationStats('tenant-1', 'agent-1');
      expect(stats.total).toBe(1);
    });
  });

  // ─── getTrustScore ────────────────────────────────────

  describe('getTrustScore', () => {
    it('should return full trust score object', () => {
      const score = trustService.getTrustScore('tenant-1', 'agent-1');
      expect(score.agentId).toBe('agent-1');
      expect(score.rawScore).toBe(50);
      expect(score.healthComponent).toBe(50);
      expect(score.delegationComponent).toBe(50);
      expect(score.provisional).toBe(true);
      expect(score.totalDelegations).toBe(0);
      expect(score.successfulDelegations).toBe(0);
      expect(typeof score.updatedAt).toBe('string');
    });

    it('should mark as provisional with < 10 delegations', () => {
      for (let i = 0; i < 9; i++) insertDelegationLog('agent-1', 'completed');
      const score = trustService.getTrustScore('tenant-1', 'agent-1');
      expect(score.provisional).toBe(true);
    });

    it('should mark as non-provisional with >= 10 delegations', () => {
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'completed');
      const score = trustService.getTrustScore('tenant-1', 'agent-1');
      expect(score.provisional).toBe(false);
    });

    it('should include correct delegation counts', () => {
      for (let i = 0; i < 7; i++) insertDelegationLog('agent-1', 'completed');
      for (let i = 0; i < 3; i++) insertDelegationLog('agent-1', 'error');
      const score = trustService.getTrustScore('tenant-1', 'agent-1');
      expect(score.totalDelegations).toBe(10);
      expect(score.successfulDelegations).toBe(7);
    });

    it('should round raw score to 2 decimal places', () => {
      insertHealthSnapshot('agent-1', '2026-02-08', 73);
      for (let i = 0; i < 3; i++) insertDelegationLog('agent-1', 'completed');
      insertDelegationLog('agent-1', 'error');
      const score = trustService.getTrustScore('tenant-1', 'agent-1');
      // health=73, delegation=75, raw = 0.6*73 + 0.4*75 = 43.8 + 30 = 73.8
      expect(score.rawScore).toBe(73.8);
    });
  });

  // ─── computePercentile ────────────────────────────────

  describe('computePercentile', () => {
    it('should return 100 when only one agent', () => {
      capStore.create('tenant-1', 'agent-1', baseCap as any);
      const percentile = trustService.computePercentile('tenant-1', 'agent-1');
      expect(percentile).toBe(100);
    });

    it('should rank agents correctly', () => {
      // agent-1: high score (all completed), agent-2: low score (all failed)
      capStore.create('tenant-1', 'agent-1', baseCap as any);
      capStore.create('tenant-1', 'agent-2', baseCap as any);
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'completed');
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-2', 'error');

      const p1 = trustService.computePercentile('tenant-1', 'agent-1');
      const p2 = trustService.computePercentile('tenant-1', 'agent-2');
      expect(p1).toBeGreaterThan(p2);
    });

    it('should handle agents with equal scores', () => {
      capStore.create('tenant-1', 'agent-1', baseCap as any);
      capStore.create('tenant-1', 'agent-2', baseCap as any);
      // Both have default scores (no data)
      const p1 = trustService.computePercentile('tenant-1', 'agent-1');
      const p2 = trustService.computePercentile('tenant-1', 'agent-2');
      expect(p1).toBe(p2);
    });

    it('should rank across 3 agents', () => {
      capStore.create('tenant-1', 'agent-1', baseCap as any);
      capStore.create('tenant-1', 'agent-2', baseCap as any);
      capStore.create('tenant-1', 'agent-3', baseCap as any);

      insertHealthSnapshot('agent-1', '2026-02-08', 90);
      insertHealthSnapshot('agent-2', '2026-02-08', 50);
      insertHealthSnapshot('agent-3', '2026-02-08', 20);

      const p1 = trustService.computePercentile('tenant-1', 'agent-1');
      const p3 = trustService.computePercentile('tenant-1', 'agent-3');
      expect(p1).toBe(100);
      expect(p3).toBe(0);
    });
  });

  // ─── updateAfterDelegation ────────────────────────────

  describe('updateAfterDelegation', () => {
    it('should update capability_registry quality metrics', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseCap as any);
      for (let i = 0; i < 5; i++) insertDelegationLog('agent-1', 'completed');
      trustService.updateAfterDelegation('tenant-1', 'agent-1');

      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated).toBeDefined();
      expect(updated!.qualityMetrics).toHaveProperty('trustRawScore');
      expect(updated!.qualityMetrics).toHaveProperty('trustScorePercentile');
    });

    it('should not throw when agent has no capabilities', () => {
      expect(() => {
        trustService.updateAfterDelegation('tenant-1', 'agent-no-caps');
      }).not.toThrow();
    });

    it('should reflect delegation outcomes in trust score', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseCap as any);
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'completed');
      trustService.updateAfterDelegation('tenant-1', 'agent-1');
      const s1 = capStore.getById('tenant-1', cap.id)!;

      // Add failures and update
      for (let i = 0; i < 10; i++) insertDelegationLog('agent-1', 'error');
      trustService.updateAfterDelegation('tenant-1', 'agent-1');
      const s2 = capStore.getById('tenant-1', cap.id)!;

      expect((s2.qualityMetrics as any).trustRawScore).toBeLessThan((s1.qualityMetrics as any).trustRawScore);
    });
  });
});
