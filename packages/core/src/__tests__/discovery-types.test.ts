/**
 * Tests for Discovery Types (Phase 4 — Story 1.2)
 */

import { describe, it, expect } from 'vitest';
import {
  TASK_TYPES,
  DELEGATION_PHASES,
} from '../discovery-types.js';
import type {
  TaskType,
  JsonSchema,
  CapabilityRegistration,
  DiscoveryQuery,
  DiscoveryResult,
  DelegationRequest,
  DelegationResult,
  DelegationPhase,
} from '../discovery-types.js';

describe('Discovery Types (Story 1.2)', () => {
  // ─── TaskType ───────────────────────────────────────────

  it('should have 9 task types', () => {
    expect(TASK_TYPES).toHaveLength(9);
  });

  it('should include all expected task types', () => {
    const expected: TaskType[] = [
      'translation', 'summarization', 'code-review', 'data-extraction',
      'classification', 'generation', 'analysis', 'transformation', 'custom',
    ];
    for (const t of expected) {
      expect(TASK_TYPES).toContain(t);
    }
  });

  // ─── CapabilityRegistration ─────────────────────────────

  it('should create a valid CapabilityRegistration', () => {
    const cap: CapabilityRegistration = {
      taskType: 'translation',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      qualityMetrics: { successRate: 0.95 },
      scope: 'internal',
    };
    expect(cap.taskType).toBe('translation');
    expect(cap.scope).toBe('internal');
  });

  it('should support custom type for custom taskType', () => {
    const cap: CapabilityRegistration = {
      taskType: 'custom',
      customType: 'my-special-task',
      inputSchema: {},
      outputSchema: {},
      qualityMetrics: {},
      scope: 'public',
    };
    expect(cap.customType).toBe('my-special-task');
  });

  it('should support all optional fields in CapabilityRegistration', () => {
    const cap: CapabilityRegistration = {
      taskType: 'analysis',
      inputSchema: {},
      outputSchema: {},
      qualityMetrics: {
        successRate: 0.9,
        avgLatencyMs: 500,
        avgCostUsd: 0.01,
        completedTasks: 100,
      },
      inputMimeTypes: ['text/plain'],
      outputMimeTypes: ['application/json'],
      estimatedLatencyMs: 500,
      estimatedCostUsd: 0.01,
      maxInputBytes: 1024,
      scope: 'internal',
    };
    expect(cap.estimatedLatencyMs).toBe(500);
  });

  // ─── DiscoveryQuery ─────────────────────────────────────

  it('should create a valid DiscoveryQuery', () => {
    const query: DiscoveryQuery = {
      taskType: 'summarization',
      scope: 'internal',
    };
    expect(query.taskType).toBe('summarization');
  });

  it('should support all filter options in DiscoveryQuery', () => {
    const query: DiscoveryQuery = {
      taskType: 'code-review',
      minTrustScore: 60,
      maxCostUsd: 0.1,
      maxLatencyMs: 1000,
      scope: 'all',
      limit: 10,
    };
    expect(query.limit).toBe(10);
  });

  // ─── DiscoveryResult ────────────────────────────────────

  it('should create a valid DiscoveryResult', () => {
    const result: DiscoveryResult = {
      anonymousAgentId: 'anon-1',
      taskType: 'translation',
      inputSchema: {},
      outputSchema: {},
      trustScorePercentile: 75,
      provisional: false,
      qualityMetrics: { successRate: 0.9, completedTasks: 50 },
    };
    expect(result.provisional).toBe(false);
  });

  it('should support provisional status in DiscoveryResult', () => {
    const result: DiscoveryResult = {
      anonymousAgentId: 'anon-2',
      taskType: 'custom',
      customType: 'my-task',
      inputSchema: {},
      outputSchema: {},
      trustScorePercentile: 50,
      provisional: true,
      qualityMetrics: {},
    };
    expect(result.provisional).toBe(true);
  });

  // ─── DelegationRequest ──────────────────────────────────

  it('should create a valid DelegationRequest', () => {
    const req: DelegationRequest = {
      requestId: 'req-1',
      targetAnonymousId: 'anon-1',
      taskType: 'translation',
      input: { text: 'hello' },
      timeoutMs: 30000,
    };
    expect(req.timeoutMs).toBe(30000);
  });

  it('should support fallback options in DelegationRequest', () => {
    const req: DelegationRequest = {
      requestId: 'req-2',
      targetAnonymousId: 'anon-2',
      taskType: 'summarization',
      input: {},
      timeoutMs: 5000,
      fallbackEnabled: true,
      maxRetries: 3,
    };
    expect(req.fallbackEnabled).toBe(true);
  });

  // ─── DelegationResult ──────────────────────────────────

  it('should create a success DelegationResult', () => {
    const result: DelegationResult = {
      requestId: 'req-1',
      status: 'success',
      output: { translated: 'hola' },
      executionTimeMs: 150,
    };
    expect(result.status).toBe('success');
  });

  it('should create a timeout DelegationResult', () => {
    const result: DelegationResult = {
      requestId: 'req-2',
      status: 'timeout',
    };
    expect(result.output).toBeUndefined();
  });

  // ─── DelegationPhase ───────────────────────────────────

  it('should have 7 delegation phases', () => {
    expect(DELEGATION_PHASES).toHaveLength(7);
  });

  it('should include all expected phases', () => {
    const expected: DelegationPhase[] = [
      'request', 'accepted', 'rejected', 'executing', 'completed', 'timeout', 'error',
    ];
    for (const p of expected) {
      expect(DELEGATION_PHASES).toContain(p);
    }
  });

  // ─── Exports from barrel ────────────────────────────────

  it('should export discovery types from core barrel', async () => {
    const core = await import('../index.js');
    expect(core.TASK_TYPES).toBeDefined();
    expect(core.DELEGATION_PHASES).toBeDefined();
  });
});
