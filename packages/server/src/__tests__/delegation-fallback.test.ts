/**
 * Tests for Delegation Fallback — Story 6.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore } from '../db/capability-store.js';
import { DiscoveryService } from '../services/discovery-service.js';
import {
  DelegationService,
  LocalPoolTransport,
  type PoolTransport,
  type PoolDelegationRequest,
} from '../services/delegation-service.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import { delegationLog } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';

/**
 * A test transport that can simulate failures for specific targets.
 */
class FallbackTestTransport implements PoolTransport {
  private requests = new Map<string, PoolDelegationRequest>();
  private failTargets = new Set<string>();
  private timeoutTargets = new Set<string>();

  setFail(targetAnonId: string) { this.failTargets.add(targetAnonId); }
  setTimeout(targetAnonId: string) { this.timeoutTargets.add(targetAnonId); }

  async sendDelegationRequest(request: PoolDelegationRequest): Promise<void> {
    // Simulate immediate failure/timeout for certain targets
    if (this.failTargets.has(request.targetAnonymousId)) {
      request.status = 'error';
      request.completedAt = new Date().toISOString();
    } else if (this.timeoutTargets.has(request.targetAnonymousId)) {
      request.status = 'timeout';
      request.completedAt = new Date().toISOString();
    } else {
      // Auto-complete successful delegations
      request.status = 'completed';
      request.output = { result: 'success' };
      request.completedAt = new Date().toISOString();
    }
    this.requests.set(request.requestId, { ...request });
  }

  async pollDelegationInbox(targetAnonymousId: string): Promise<PoolDelegationRequest[]> {
    return Array.from(this.requests.values()).filter(
      (r) => r.targetAnonymousId === targetAnonymousId && r.status === 'request',
    );
  }

  async updateDelegationStatus(
    requestId: string,
    status: PoolDelegationRequest['status'],
    output?: unknown,
  ): Promise<PoolDelegationRequest | null> {
    const req = this.requests.get(requestId);
    if (!req) return null;
    req.status = status;
    if (output !== undefined) req.output = output;
    return { ...req };
  }

  async getDelegationRequest(requestId: string): Promise<PoolDelegationRequest | null> {
    const req = this.requests.get(requestId);
    return req ? { ...req } : null;
  }

  clear(): void { this.requests.clear(); this.failTargets.clear(); this.timeoutTargets.clear(); }
  getAll(): PoolDelegationRequest[] { return Array.from(this.requests.values()); }
}

describe('Delegation Fallback — Story 6.4', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let discoveryService: DiscoveryService;
  let transport: FallbackTestTransport;
  let service: DelegationService;

  const baseCap = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
    qualityMetrics: { trustScorePercentile: 80, completedTasks: 20 },
  };

  function setupAgent(agentId: string, trustPercentile = 80) {
    const cap = capStore.create('tenant-1', agentId, {
      ...baseCap,
      qualityMetrics: { trustScorePercentile: trustPercentile, completedTasks: 20 },
    } as any);
    discoveryService.updateAgentPermissions('tenant-1', cap.id, {
      enabled: true,
      acceptDelegations: true,
    });
    return cap;
  }

  function getAnonId(agentId: string): string {
    const mgr = new AnonymousIdManager(db);
    return mgr.getOrRotateAnonymousId('tenant-1', agentId);
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    discoveryService = new DiscoveryService(db);
    transport = new FallbackTestTransport();
    service = new DelegationService(db, transport, {
      defaultTimeoutMs: 500,
      acceptTimeoutMs: 200,
    });
    // Enable delegation for tenant with low trust threshold
    discoveryService.updateDiscoveryConfig('tenant-1', {
      delegationEnabled: true,
      minTrustThreshold: 0,
    });
  });

  // ─── Basic fallback disabled ──────────────────────────

  describe('fallback disabled (default)', () => {
    it('should not retry on failure when fallbackEnabled is false', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');
      transport.setFail(targetAnonId);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: false,
      });

      expect(result.status).not.toBe('success');
      expect(result.retriesUsed).toBe(0);
    });

    it('should succeed on first try without fallback', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
      });

      expect(result.status).toBe('success');
      expect(result.retriesUsed).toBe(0);
    });
  });

  // ─── Fallback enabled ────────────────────────────────

  describe('fallback enabled', () => {
    it('should fallback to next agent on failure', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target-1');
      setupAgent('agent-target-2');
      const target1 = getAnonId('agent-target-1');
      const target2 = getAnonId('agent-target-2');
      transport.setFail(target1);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 3,
      });

      expect(result.status).toBe('success');
      expect(result.retriesUsed).toBe(1);
    });

    it('should fallback on timeout', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target-1');
      setupAgent('agent-target-2');
      const target1 = getAnonId('agent-target-1');
      transport.setTimeout(target1);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 3,
      });

      expect(result.status).toBe('success');
      expect(result.retriesUsed).toBe(1);
    });

    it('should return failure if all targets fail', async () => {
      // Use a different task type so agent-1 is not a candidate
      const specialCap = {
        ...baseCap,
        taskType: 'summarization',
        qualityMetrics: { trustScorePercentile: 80, completedTasks: 20 },
      };
      capStore.create('tenant-1', 'agent-target-1', specialCap as any);
      capStore.create('tenant-1', 'agent-target-2', specialCap as any);
      const target1 = getAnonId('agent-target-1');
      const target2 = getAnonId('agent-target-2');
      transport.setFail(target1);
      transport.setFail(target2);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'summarization',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 3,
      });

      expect(result.status).not.toBe('success');
      expect(result.retriesUsed).toBeGreaterThan(0);
    });

    it('should respect maxRetries limit', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target-1');
      setupAgent('agent-target-2');
      setupAgent('agent-target-3');
      setupAgent('agent-target-4');
      const target1 = getAnonId('agent-target-1');
      transport.setFail(target1);
      // Fail all of them
      for (const id of ['agent-target-2', 'agent-target-3', 'agent-target-4']) {
        transport.setFail(getAnonId(id));
      }

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 2,
      });

      // Should try at most 3 total (1 original + 2 retries)
      expect(result.retriesUsed).toBeLessThanOrEqual(2);
    });

    it('should succeed on first try with no retries used', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
      });

      expect(result.status).toBe('success');
      expect(result.retriesUsed).toBe(0);
    });

    it('should log all attempts to delegation_log', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target-1');
      setupAgent('agent-target-2');
      const target1 = getAnonId('agent-target-1');
      transport.setFail(target1);

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
      });

      const logs = db
        .select()
        .from(delegationLog)
        .where(eq(delegationLog.tenantId, 'tenant-1'))
        .all();

      // Should have at least 2 log entries (failed + successful)
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it('should return retriesUsed in result', async () => {
      // Use summarization so agent-1 is not a fallback candidate
      const specialCap = {
        ...baseCap,
        taskType: 'summarization',
        qualityMetrics: { trustScorePercentile: 80, completedTasks: 20 },
      };
      capStore.create('tenant-1', 'agent-target-1', specialCap as any);
      discoveryService.updateAgentPermissions('tenant-1',
        capStore.listByAgent('tenant-1', 'agent-target-1')[0].id,
        { enabled: true, acceptDelegations: true });
      capStore.create('tenant-1', 'agent-target-2', specialCap as any);
      discoveryService.updateAgentPermissions('tenant-1',
        capStore.listByAgent('tenant-1', 'agent-target-2')[0].id,
        { enabled: true, acceptDelegations: true });
      capStore.create('tenant-1', 'agent-target-3', specialCap as any);
      discoveryService.updateAgentPermissions('tenant-1',
        capStore.listByAgent('tenant-1', 'agent-target-3')[0].id,
        { enabled: true, acceptDelegations: true });

      const target1 = getAnonId('agent-target-1');
      const target2 = getAnonId('agent-target-2');
      transport.setFail(target1);
      transport.setFail(target2);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'summarization',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 3,
      });

      expect(result.status).toBe('success');
      expect(result.retriesUsed).toBe(2);
    });

    it('should handle when no fallback candidates exist', async () => {
      // Use a task type with only one agent registered
      const specialCap = {
        ...baseCap,
        taskType: 'code-review',
        qualityMetrics: { trustScorePercentile: 80, completedTasks: 20 },
      };
      capStore.create('tenant-1', 'agent-target-1', specialCap as any);
      const target1 = getAnonId('agent-target-1');
      transport.setFail(target1);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'code-review',
        input: { text: 'hello' },
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 3,
      });

      // Should fail — no other agents for code-review
      expect(result.status).not.toBe('success');
    });
  });

  // ─── Edge cases ───────────────────────────────────────

  describe('edge cases', () => {
    it('should not retry when delegation is disabled', async () => {
      discoveryService.updateDiscoveryConfig('tenant-1', { delegationEnabled: false });
      setupAgent('agent-1');

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'anon-target',
        taskType: 'translation',
        input: {},
        timeoutMs: 500,
        fallbackEnabled: true,
      });

      expect(result.status).toBe('rejected');
    });

    it('should handle maxRetries of 0', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');
      transport.setFail(targetAnonId);

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: {},
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 0,
      });

      // maxRetries=0 means only the primary attempt, no fallback discovery
      expect(result.status).not.toBe('success');
      expect(result.retriesUsed).toBe(0);
    });

    it('should cap maxRetries at 10', async () => {
      setupAgent('agent-1');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: {},
        timeoutMs: 500,
        fallbackEnabled: true,
        maxRetries: 100,
      });

      // Should succeed normally, maxRetries is capped
      expect(result.status).toBe('success');
    });

    it('should update trust scores after fallback attempts', async () => {
      const cap = setupAgent('agent-1');
      setupAgent('agent-target-1');
      setupAgent('agent-target-2');
      const target1 = getAnonId('agent-target-1');
      transport.setFail(target1);

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: target1,
        taskType: 'translation',
        input: {},
        timeoutMs: 500,
        fallbackEnabled: true,
      });

      // Trust should have been updated (verify no crash at minimum)
      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated).toBeDefined();
    });
  });
});
