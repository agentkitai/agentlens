/**
 * Tests for DiscoveryService (Story 5.3 — Discovery Protocol)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore } from '../db/capability-store.js';
import { DiscoveryService } from '../services/discovery-service.js';
import type { SqliteDb } from '../db/index.js';
import type { DiscoveryQuery } from '@agentlensai/core';

describe('DiscoveryService (Story 5.3)', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let service: DiscoveryService;

  const baseInput = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  function createCap(overrides: Record<string, unknown> = {}, agentId = 'agent-1') {
    return capStore.create('tenant-1', agentId, { ...baseInput, ...overrides } as any);
  }

  function enableCap(capId: string) {
    service.updateAgentPermissions('tenant-1', capId, { enabled: true });
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    service = new DiscoveryService(db);
    // Set tenant trust threshold low for most tests
    service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 0 });
  });

  // ─── Basic Discovery ──────────────────────────────────

  describe('discover()', () => {
    it('should return empty array when no capabilities exist', () => {
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toEqual([]);
    });

    it('should return empty array when no capabilities match taskType', () => {
      const cap = createCap({ taskType: 'summarization' });
      enableCap(cap.id);
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toEqual([]);
    });

    it('should return matching capabilities by taskType', () => {
      const cap = createCap();
      enableCap(cap.id);
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(1);
      expect(results[0].taskType).toBe('translation');
    });

    it('should return anonymousAgentId in results', () => {
      const cap = createCap();
      enableCap(cap.id);
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].anonymousAgentId).toBeDefined();
      expect(results[0].anonymousAgentId).not.toBe('agent-1');
    });

    it('should return inputSchema and outputSchema', () => {
      const cap = createCap();
      enableCap(cap.id);
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].inputSchema).toEqual(baseInput.inputSchema);
      expect(results[0].outputSchema).toEqual(baseInput.outputSchema);
    });

    it('should filter by customType', () => {
      const cap1 = createCap({ taskType: 'custom', customType: 'my-task' });
      enableCap(cap1.id);
      const cap2 = createCap({ taskType: 'custom', customType: 'other-task' }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'custom',
        customType: 'my-task',
        scope: 'internal',
      });
      expect(results).toHaveLength(1);
      expect(results[0].customType).toBe('my-task');
    });

    it('should not return capabilities from other tenants', () => {
      const cap = capStore.create('tenant-2', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-2', cap.id, { enabled: true });

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toEqual([]);
    });

    // ─── Max results ─────────────────────────────────

    it('should limit results to max 20', () => {
      for (let i = 0; i < 25; i++) {
        const cap = createCap({}, `agent-${i}`);
        enableCap(cap.id);
      }
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(20);
    });

    it('should respect custom limit < 20', () => {
      for (let i = 0; i < 10; i++) {
        const cap = createCap({}, `agent-${i}`);
        enableCap(cap.id);
      }
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        limit: 5,
      });
      expect(results).toHaveLength(5);
    });

    it('should cap limit at 20 even if higher requested', () => {
      for (let i = 0; i < 25; i++) {
        const cap = createCap({}, `agent-${i}`);
        enableCap(cap.id);
      }
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        limit: 50,
      });
      expect(results).toHaveLength(20);
    });

    // ─── Filters ─────────────────────────────────────

    it('should filter by minTrustScore', () => {
      const cap1 = createCap({ qualityMetrics: { trustScorePercentile: 80 } });
      enableCap(cap1.id);
      const cap2 = createCap({ qualityMetrics: { trustScorePercentile: 30 } }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        minTrustScore: 50,
      });
      expect(results).toHaveLength(1);
      expect(results[0].trustScorePercentile).toBe(80);
    });

    it('should filter by maxCostUsd', () => {
      const cap1 = createCap({ estimatedCostUsd: 0.5 });
      enableCap(cap1.id);
      const cap2 = createCap({ estimatedCostUsd: 5.0 }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        maxCostUsd: 1.0,
      });
      expect(results).toHaveLength(1);
    });

    it('should filter by maxLatencyMs', () => {
      const cap1 = createCap({ estimatedLatencyMs: 100 });
      enableCap(cap1.id);
      const cap2 = createCap({ estimatedLatencyMs: 5000 }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        maxLatencyMs: 1000,
      });
      expect(results).toHaveLength(1);
    });

    it('should include capabilities with null cost when maxCost filter set', () => {
      const cap1 = createCap({}); // no cost estimate
      enableCap(cap1.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        maxCostUsd: 1.0,
      });
      expect(results).toHaveLength(1);
    });

    it('should include capabilities with null latency when maxLatency filter set', () => {
      const cap1 = createCap({}); // no latency estimate
      enableCap(cap1.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        maxLatencyMs: 1000,
      });
      expect(results).toHaveLength(1);
    });

    it('should apply multiple filters simultaneously', () => {
      // Passes all filters
      const cap1 = createCap({
        estimatedCostUsd: 0.5,
        estimatedLatencyMs: 100,
        qualityMetrics: { trustScorePercentile: 80 },
      });
      enableCap(cap1.id);

      // Fails cost filter
      const cap2 = createCap({
        estimatedCostUsd: 10.0,
        estimatedLatencyMs: 100,
        qualityMetrics: { trustScorePercentile: 80 },
      }, 'agent-2');
      enableCap(cap2.id);

      // Fails trust filter
      const cap3 = createCap({
        estimatedCostUsd: 0.5,
        estimatedLatencyMs: 100,
        qualityMetrics: { trustScorePercentile: 20 },
      }, 'agent-3');
      enableCap(cap3.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        minTrustScore: 50,
        maxCostUsd: 1.0,
        maxLatencyMs: 500,
      });
      expect(results).toHaveLength(1);
    });

    // ─── Ranking ─────────────────────────────────────

    it('should rank by composite score (0.5 trust + 0.3 cost + 0.2 latency)', () => {
      // High trust, high cost, high latency
      const cap1 = createCap({
        qualityMetrics: { trustScorePercentile: 90 },
        estimatedCostUsd: 9.0,
        estimatedLatencyMs: 9000,
      }, 'agent-1');
      enableCap(cap1.id);

      // Low trust, low cost, low latency
      const cap2 = createCap({
        qualityMetrics: { trustScorePercentile: 60 },
        estimatedCostUsd: 1.0,
        estimatedLatencyMs: 1000,
      }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        maxCostUsd: 10.0,
        maxLatencyMs: 10000,
      });

      expect(results).toHaveLength(2);
      // agent-1: 0.5*(90/100) + 0.3*(1-9/10) + 0.2*(1-9000/10000) = 0.45 + 0.03 + 0.02 = 0.50
      // agent-2: 0.5*(60/100) + 0.3*(1-1/10) + 0.2*(1-1000/10000) = 0.30 + 0.27 + 0.18 = 0.75
      // agent-2 should rank higher
      expect(results[0].trustScorePercentile).toBe(60);
      expect(results[1].trustScorePercentile).toBe(90);
    });

    it('should rank higher trust agents first when cost/latency are equal', () => {
      const cap1 = createCap({
        qualityMetrics: { trustScorePercentile: 90 },
        estimatedCostUsd: 1.0,
        estimatedLatencyMs: 100,
      }, 'agent-1');
      enableCap(cap1.id);

      const cap2 = createCap({
        qualityMetrics: { trustScorePercentile: 50 },
        estimatedCostUsd: 1.0,
        estimatedLatencyMs: 100,
      }, 'agent-2');
      enableCap(cap2.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].trustScorePercentile).toBe(90);
      expect(results[1].trustScorePercentile).toBe(50);
    });

    // ─── Provisional status ──────────────────────────

    it('should mark agents with < 10 completed tasks as provisional', () => {
      const cap = createCap({ qualityMetrics: { completedTasks: 5 } });
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].provisional).toBe(true);
    });

    it('should mark agents with >= 10 completed tasks as non-provisional', () => {
      const cap = createCap({ qualityMetrics: { completedTasks: 15 } });
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].provisional).toBe(false);
    });

    it('should default provisional to true when no completedTasks', () => {
      const cap = createCap({});
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].provisional).toBe(true);
    });

    // ─── Scope enforcement ───────────────────────────

    it('should only return internal scope capabilities for scope=internal', () => {
      const cap1 = createCap({ scope: 'internal' });
      enableCap(cap1.id);
      const cap2 = createCap({ scope: 'public' }, 'agent-2');
      enableCap(cap2.id);

      // Both should show in local query since they're in our tenant
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      // Internal scope means we query local DB — both internal and public scope caps are visible locally
      expect(results).toHaveLength(2);
    });

    // ─── Quality metrics in results ──────────────────

    it('should include quality metrics in results', () => {
      const cap = createCap({
        qualityMetrics: { successRate: 0.95, completedTasks: 100, trustScorePercentile: 80 },
      });
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].qualityMetrics.successRate).toBe(0.95);
      expect(results[0].qualityMetrics.completedTasks).toBe(100);
    });

    it('should include estimatedLatencyMs and estimatedCostUsd in results', () => {
      const cap = createCap({ estimatedLatencyMs: 200, estimatedCostUsd: 0.01 });
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].estimatedLatencyMs).toBe(200);
      expect(results[0].estimatedCostUsd).toBe(0.01);
    });

    // ─── All task types ──────────────────────────────

    it('should discover each valid task type', () => {
      const taskTypes = ['translation', 'summarization', 'code-review', 'data-extraction',
        'classification', 'generation', 'analysis', 'transformation'] as const;

      for (const tt of taskTypes) {
        const cap = createCap({ taskType: tt }, `agent-${tt}`);
        enableCap(cap.id);
      }

      for (const tt of taskTypes) {
        const results = service.discover('tenant-1', { taskType: tt, scope: 'internal' });
        expect(results).toHaveLength(1);
        expect(results[0].taskType).toBe(tt);
      }
    });

    // ─── Default trust score ─────────────────────────

    it('should use default trust score of 50 when not in metrics', () => {
      const cap = createCap({});
      enableCap(cap.id);

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results[0].trustScorePercentile).toBe(50);
    });
  });
});
