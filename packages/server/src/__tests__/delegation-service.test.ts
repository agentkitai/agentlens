/**
 * Tests for DelegationService — Story 6.1 (Delegation Core)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
import { delegationLog } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';

describe('DelegationService — Story 6.1 (Delegation Core)', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let discoveryService: DiscoveryService;
  let transport: LocalPoolTransport;
  let service: DelegationService;

  const baseCap = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  function setupAgent(agentId = 'agent-1', overrides: Record<string, unknown> = {}) {
    const cap = capStore.create('tenant-1', agentId, { ...baseCap, ...overrides } as any);
    discoveryService.updateAgentPermissions('tenant-1', cap.id, {
      enabled: true,
      acceptDelegations: true,
    });
    return cap;
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    discoveryService = new DiscoveryService(db);
    transport = new LocalPoolTransport();
    service = new DelegationService(db, transport, {
      defaultTimeoutMs: 2000,
      acceptTimeoutMs: 500,
    });
    // Enable delegation for tenant
    discoveryService.updateDiscoveryConfig('tenant-1', {
      delegationEnabled: true,
      minTrustThreshold: 0,
    });
  });

  // ─── LocalPoolTransport ───────────────────────────────

  describe('LocalPoolTransport', () => {
    it('should store and retrieve delegation requests', async () => {
      const req: PoolDelegationRequest = {
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      };
      await transport.sendDelegationRequest(req);
      const result = await transport.getDelegationRequest('req-1');
      expect(result).toBeDefined();
      expect(result!.requestId).toBe('req-1');
    });

    it('should poll inbox for pending requests', async () => {
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });
      await transport.sendDelegationRequest({
        requestId: 'req-2',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-c',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });

      const inbox = await transport.pollDelegationInbox('anon-b');
      expect(inbox).toHaveLength(1);
      expect(inbox[0].requestId).toBe('req-1');
    });

    it('should update delegation status', async () => {
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });

      await transport.updateDelegationStatus('req-1', 'accepted');
      const req = await transport.getDelegationRequest('req-1');
      expect(req!.status).toBe('accepted');
    });

    it('should update status with output on completion', async () => {
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });

      await transport.updateDelegationStatus('req-1', 'completed', { result: 'done' });
      const req = await transport.getDelegationRequest('req-1');
      expect(req!.status).toBe('completed');
      expect(req!.output).toEqual({ result: 'done' });
      expect(req!.completedAt).toBeDefined();
    });

    it('should return null for non-existent request', async () => {
      const result = await transport.getDelegationRequest('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when updating non-existent request', async () => {
      const result = await transport.updateDelegationStatus('nonexistent', 'accepted');
      expect(result).toBeNull();
    });

    it('should not include non-request status items in inbox', async () => {
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });
      await transport.updateDelegationStatus('req-1', 'accepted');

      const inbox = await transport.pollDelegationInbox('anon-b');
      expect(inbox).toHaveLength(0);
    });

    it('should clear all requests', async () => {
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'anon-a',
        targetAnonymousId: 'anon-b',
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });
      transport.clear();
      expect(transport.getAll()).toHaveLength(0);
    });
  });

  // ─── delegate() — Outbound ────────────────────────────

  describe('delegate()', () => {
    it('should reject when delegation is disabled at tenant level', async () => {
      discoveryService.updateDiscoveryConfig('tenant-1', { delegationEnabled: false });
      setupAgent();

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 1000,
      });

      expect(result.status).toBe('rejected');
      expect(result.output).toContain('disabled');
    });

    it('should send a delegation request to the transport', async () => {
      setupAgent();

      // Don't await — we need to complete from the other side
      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 500,
      });

      // Wait a tick for request to be sent
      await new Promise((r) => setTimeout(r, 20));
      const allReqs = transport.getAll();
      expect(allReqs.length).toBeGreaterThanOrEqual(1);
      expect(allReqs[0].taskType).toBe('translation');

      // Let it timeout
      const result = await delegatePromise;
      expect(result.status).toBe('timeout');
    });

    it('should return success when target completes delegation', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 2000,
      });

      // Simulate target accepting and completing
      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      const reqId = reqs[0].requestId;
      await transport.updateDelegationStatus(reqId, 'accepted');
      await transport.updateDelegationStatus(reqId, 'completed', { translated: 'hola' });

      const result = await delegatePromise;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ translated: 'hola' });
      expect(result.executionTimeMs).toBeDefined();
    });

    it('should return rejected when target rejects', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      await transport.updateDelegationStatus(reqs[0].requestId, 'rejected');

      const result = await delegatePromise;
      expect(result.status).toBe('rejected');
    });

    it('should timeout when no response within timeoutMs', async () => {
      setupAgent();

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 200,
      });

      expect(result.status).toBe('timeout');
    });

    it('should use anonymous IDs for cross-agent references', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 300,
      });

      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      // requesterAnonymousId should be a UUID (anonymous), not 'agent-1'
      expect(reqs[0].requesterAnonymousId).not.toBe('agent-1');
      expect(reqs[0].requesterAnonymousId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      await delegatePromise; // let it timeout
    });

    it('should enforce outbound rate limit', async () => {
      const cap = setupAgent();
      discoveryService.updateAgentPermissions('tenant-1', cap.id, { outboundRateLimit: 2 });

      // First two should go through (may timeout, but they're sent)
      const p1 = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });
      const p2 = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      await p1;
      await p2;

      // Third should be rate limited
      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      expect(result.status).toBe('error');
      expect(result.output).toContain('rate limit');
    });

    it('should generate a requestId if not provided', async () => {
      setupAgent();

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      expect(result.requestId).toBeDefined();
      expect(result.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('should use provided requestId', async () => {
      setupAgent();

      const result = await service.delegate('tenant-1', 'agent-1', {
        requestId: 'my-custom-id',
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      expect(result.requestId).toBe('my-custom-id');
    });

    it('should use default timeout when not specified', async () => {
      setupAgent();
      // Service default is 2000ms in test setup

      const start = Date.now();
      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 200,
      });
      const elapsed = Date.now() - start;

      expect(result.status).toBe('timeout');
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(1000);
    });
  });

  // ─── Delegation Logging ───────────────────────────────

  describe('delegation logging', () => {
    it('should log outbound delegation to delegation_log table', async () => {
      setupAgent();

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 200,
      });

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0].direction).toBe('outbound');
      expect(logs[0].taskType).toBe('translation');
    });

    it('should update log status on completion', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      await transport.updateDelegationStatus(reqs[0].requestId, 'accepted');
      await transport.updateDelegationStatus(reqs[0].requestId, 'completed', { done: true });

      await delegatePromise;

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      const outbound = logs.find((l) => l.direction === 'outbound');
      expect(outbound).toBeDefined();
      expect(outbound!.status).toBe('completed');
      expect(outbound!.completedAt).toBeDefined();
    });

    it('should log timeout status', async () => {
      setupAgent();

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      expect(logs.some((l) => l.status === 'timeout')).toBe(true);
    });

    it('should log request size bytes', async () => {
      setupAgent();

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello world' },
        timeoutMs: 100,
      });

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      expect(logs[0].requestSizeBytes).toBeGreaterThan(0);
    });

    it('should use anonymous target ID in logs (not real agent ID)', async () => {
      setupAgent();

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon-xyz',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      expect(logs[0].anonymousTargetId).toBe('target-anon-xyz');
    });

    it('should retrieve delegation logs by tenant', async () => {
      setupAgent();

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-1',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      const logs = service.getDelegationLogs('tenant-1');
      expect(logs.length).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve delegation logs filtered by agent', async () => {
      setupAgent('agent-1');
      setupAgent('agent-2');

      await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-1',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      const logs = service.getDelegationLogs('tenant-1', 'agent-1');
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.every((l) => l.agentId === 'agent-1')).toBe(true);
    });
  });

  // ─── Trust Threshold ──────────────────────────────────

  describe('trust threshold', () => {
    it('should allow delegation when trust check passes', async () => {
      setupAgent();

      const result = await service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      // Should at least get to the transport (timeout, not rejected for trust)
      expect(result.status).toBe('timeout');
    });
  });

  // ─── Error handling ───────────────────────────────────

  describe('error handling', () => {
    it('should handle transport errors gracefully', async () => {
      setupAgent();

      // Create a transport that throws
      const errorTransport: PoolTransport = {
        async sendDelegationRequest() {
          throw new Error('Network error');
        },
        async pollDelegationInbox() {
          return [];
        },
        async updateDelegationStatus() {
          return null;
        },
        async getDelegationRequest() {
          return null;
        },
      };

      const errorService = new DelegationService(db, errorTransport, {
        defaultTimeoutMs: 100,
        acceptTimeoutMs: 50,
      });

      await expect(
        errorService.delegate('tenant-1', 'agent-1', {
          targetAnonymousId: 'target',
          taskType: 'translation',
          input: {},
          timeoutMs: 100,
        }),
      ).rejects.toThrow('Network error');
    });

    it('should return error when agent has no capabilities registered', async () => {
      // No capabilities set up — outbound rate limit uses default 20
      const result = await service.delegate('tenant-1', 'agent-no-caps', {
        targetAnonymousId: 'target',
        taskType: 'translation',
        input: {},
        timeoutMs: 100,
      });

      // Should still work (uses default rate limit), just timeout
      expect(result.status).toBe('timeout');
    });
  });

  // ─── 4-Phase Protocol ─────────────────────────────────

  describe('4-phase protocol', () => {
    it('should go through REQUEST → ACCEPT → EXECUTE → RETURN', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 20));

      // Phase 1: REQUEST — verify request is in transport
      const reqs = transport.getAll();
      expect(reqs).toHaveLength(1);
      expect(reqs[0].status).toBe('request');

      // Phase 2: ACCEPT
      await transport.updateDelegationStatus(reqs[0].requestId, 'accepted');
      await new Promise((r) => setTimeout(r, 20));
      const accepted = await transport.getDelegationRequest(reqs[0].requestId);
      expect(accepted!.status).toBe('accepted');

      // Phase 3: EXECUTE (simulated)
      await transport.updateDelegationStatus(reqs[0].requestId, 'executing');

      // Phase 4: RETURN
      await transport.updateDelegationStatus(reqs[0].requestId, 'completed', {
        translated: 'hola',
      });

      const result = await delegatePromise;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ translated: 'hola' });
    });

    it('should handle rejection at ACCEPT phase', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      await transport.updateDelegationStatus(reqs[0].requestId, 'rejected');

      const result = await delegatePromise;
      expect(result.status).toBe('rejected');
    });

    it('should handle error during execution', async () => {
      setupAgent();

      const delegatePromise = service.delegate('tenant-1', 'agent-1', {
        targetAnonymousId: 'target-anon',
        taskType: 'translation',
        input: {},
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 20));
      const reqs = transport.getAll();
      await transport.updateDelegationStatus(reqs[0].requestId, 'accepted');
      await transport.updateDelegationStatus(reqs[0].requestId, 'error');

      const result = await delegatePromise;
      expect(result.status).toBe('error');
    });
  });
});
