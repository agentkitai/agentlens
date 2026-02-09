/**
 * Tests for Delegation Inbox & Acceptance — Story 6.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore } from '../db/capability-store.js';
import { DiscoveryService } from '../services/discovery-service.js';
import { AnonymousIdManager } from '../db/anonymous-id-manager.js';
import {
  DelegationService,
  LocalPoolTransport,
  type PoolDelegationRequest,
} from '../services/delegation-service.js';
import { delegationLog } from '../db/schema.sqlite.js';
import { eq } from 'drizzle-orm';
import type { SqliteDb } from '../db/index.js';

describe('Delegation Inbox & Acceptance — Story 6.2', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let discoveryService: DiscoveryService;
  let anonIdManager: AnonymousIdManager;
  let transport: LocalPoolTransport;
  let service: DelegationService;

  const baseCap = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  function setupAgent(agentId = 'agent-target', opts: { acceptDelegations?: boolean } = {}) {
    const cap = capStore.create('tenant-1', agentId, baseCap as any);
    discoveryService.updateAgentPermissions('tenant-1', cap.id, {
      enabled: true,
      acceptDelegations: opts.acceptDelegations ?? true,
    });
    return cap;
  }

  function getAnonId(agentId: string): string {
    return anonIdManager.getOrRotateAnonymousId('tenant-1', agentId);
  }

  async function createInboundRequest(
    targetAgentId: string,
    overrides: Partial<PoolDelegationRequest> = {},
  ): Promise<PoolDelegationRequest> {
    const targetAnonId = getAnonId(targetAgentId);
    const req: PoolDelegationRequest = {
      requestId: overrides.requestId ?? `req-${Math.random().toString(36).slice(2, 8)}`,
      requesterAnonymousId: overrides.requesterAnonymousId ?? 'requester-anon-1',
      targetAnonymousId: targetAnonId,
      taskType: (overrides.taskType as any) ?? 'translation',
      input: overrides.input ?? { text: 'hello' },
      timeoutMs: overrides.timeoutMs ?? 30000,
      status: overrides.status ?? 'request',
      createdAt: overrides.createdAt ?? new Date().toISOString(),
    };
    await transport.sendDelegationRequest(req);
    return req;
  }

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    discoveryService = new DiscoveryService(db);
    anonIdManager = new AnonymousIdManager(db);
    transport = new LocalPoolTransport();
    service = new DelegationService(db, transport, {
      defaultTimeoutMs: 2000,
      acceptTimeoutMs: 500,
    });
    discoveryService.updateDiscoveryConfig('tenant-1', {
      delegationEnabled: true,
      minTrustThreshold: 0,
    });
  });

  // ─── getInbox() ───────────────────────────────────────

  describe('getInbox()', () => {
    it('should return empty inbox when no pending requests', async () => {
      setupAgent();
      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toEqual([]);
    });

    it('should return pending requests for the agent', async () => {
      setupAgent();
      await createInboundRequest('agent-target');

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(1);
      expect(inbox[0].status).toBe('request');
    });

    it('should not return requests for other agents', async () => {
      setupAgent('agent-target');
      setupAgent('agent-other');
      await createInboundRequest('agent-other');

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(0);
    });

    it('should return multiple pending requests', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await createInboundRequest('agent-target', { requestId: 'req-2' });
      await createInboundRequest('agent-target', { requestId: 'req-3' });

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(3);
    });

    it('should auto-reject expired requests (accept timeout)', async () => {
      setupAgent();

      // Create a request with old timestamp (> acceptTimeoutMs ago)
      const oldTime = new Date(Date.now() - 1000).toISOString(); // 1s ago, timeout is 500ms
      await createInboundRequest('agent-target', {
        requestId: 'old-req',
        createdAt: oldTime,
      });

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(0);

      // Verify it was auto-rejected (set to timeout)
      const req = await transport.getDelegationRequest('old-req');
      expect(req!.status).toBe('timeout');
    });

    it('should keep non-expired requests', async () => {
      setupAgent();

      // Fresh request
      await createInboundRequest('agent-target', {
        requestId: 'fresh-req',
        createdAt: new Date().toISOString(),
      });

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(1);
      expect(inbox[0].requestId).toBe('fresh-req');
    });
  });

  // ─── acceptDelegation() ───────────────────────────────

  describe('acceptDelegation()', () => {
    it('should accept a pending delegation request', async () => {
      setupAgent();
      const req = await createInboundRequest('agent-target', { requestId: 'req-1' });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(true);

      const updated = await transport.getDelegationRequest('req-1');
      expect(updated!.status).toBe('accepted');
    });

    it('should reject when acceptDelegations is disabled', async () => {
      setupAgent('agent-target', { acceptDelegations: false });
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('does not accept delegations');

      const updated = await transport.getDelegationRequest('req-1');
      expect(updated!.status).toBe('rejected');
    });

    it('should reject when request does not exist', async () => {
      setupAgent();

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should reject when accept timeout has passed', async () => {
      setupAgent();

      const oldTime = new Date(Date.now() - 1000).toISOString();
      await createInboundRequest('agent-target', {
        requestId: 'old-req',
        createdAt: oldTime,
      });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'old-req');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should reject when request is not in request status', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await transport.updateDelegationStatus('req-1', 'accepted');

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot accept');
    });

    it('should reject when request targets a different agent', async () => {
      setupAgent('agent-target');
      setupAgent('agent-other');

      // Create request targeting agent-other
      await createInboundRequest('agent-other', { requestId: 'req-1' });

      // Try to accept as agent-target
      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not targeted');
    });

    it('should log inbound delegation on accept', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');

      const logs = db
        .select()
        .from(delegationLog)
        .where(eq(delegationLog.tenantId, 'tenant-1'))
        .all();
      const inbound = logs.find((l) => l.direction === 'inbound');
      expect(inbound).toBeDefined();
      expect(inbound!.status).toBe('accepted');
    });

    it('should enforce inbound rate limiting', async () => {
      const cap = setupAgent();
      discoveryService.updateAgentPermissions('tenant-1', cap.id, { inboundRateLimit: 2 });

      // Accept 2 requests
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      const r1 = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(r1.ok).toBe(true);

      await createInboundRequest('agent-target', { requestId: 'req-2' });
      const r2 = await service.acceptDelegation('tenant-1', 'agent-target', 'req-2');
      expect(r2.ok).toBe(true);

      // Third should be rate limited
      await createInboundRequest('agent-target', { requestId: 'req-3' });
      const r3 = await service.acceptDelegation('tenant-1', 'agent-target', 'req-3');
      expect(r3.ok).toBe(false);
      expect(r3.error).toContain('rate limit');
    });
  });

  // ─── rejectDelegation() ───────────────────────────────

  describe('rejectDelegation()', () => {
    it('should reject a pending delegation request', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      const result = await service.rejectDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(true);

      const updated = await transport.getDelegationRequest('req-1');
      expect(updated!.status).toBe('rejected');
    });

    it('should reject an already-accepted delegation', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');

      const result = await service.rejectDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(true);
    });

    it('should fail when request does not exist', async () => {
      setupAgent();
      const result = await service.rejectDelegation('tenant-1', 'agent-target', 'nonexistent');
      expect(result.ok).toBe(false);
    });

    it('should fail when request is already completed', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await transport.updateDelegationStatus('req-1', 'accepted');
      await transport.updateDelegationStatus('req-1', 'completed', {});

      const result = await service.rejectDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot reject');
    });

    it('should fail when request targets a different agent', async () => {
      setupAgent('agent-target');
      setupAgent('agent-other');
      await createInboundRequest('agent-other', { requestId: 'req-1' });

      const result = await service.rejectDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not targeted');
    });

    it('should log rejection', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      await service.rejectDelegation('tenant-1', 'agent-target', 'req-1');

      const logs = db.select().from(delegationLog).where(eq(delegationLog.tenantId, 'tenant-1')).all();
      const rejected = logs.find((l) => l.status === 'rejected');
      expect(rejected).toBeDefined();
    });
  });

  // ─── completeDelegation() ─────────────────────────────

  describe('completeDelegation()', () => {
    it('should complete an accepted delegation with output', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');

      const result = await service.completeDelegation('tenant-1', 'agent-target', 'req-1', {
        translated: 'hola',
      });
      expect(result.ok).toBe(true);

      const updated = await transport.getDelegationRequest('req-1');
      expect(updated!.status).toBe('completed');
      expect(updated!.output).toEqual({ translated: 'hola' });
    });

    it('should fail when request is not in accepted/executing status', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      // Still in 'request' status, not 'accepted'
      const result = await service.completeDelegation('tenant-1', 'agent-target', 'req-1', {});
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot complete');
    });

    it('should fail when request does not exist', async () => {
      setupAgent();
      const result = await service.completeDelegation('tenant-1', 'agent-target', 'nonexistent', {});
      expect(result.ok).toBe(false);
    });

    it('should fail when request targets a different agent', async () => {
      setupAgent('agent-target');
      setupAgent('agent-other');
      await createInboundRequest('agent-other', { requestId: 'req-1' });
      await transport.updateDelegationStatus('req-1', 'accepted');

      const result = await service.completeDelegation('tenant-1', 'agent-target', 'req-1', {});
      expect(result.ok).toBe(false);
    });

    it('should complete with complex output', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');

      const complexOutput = {
        translated: 'hola',
        confidence: 0.95,
        alternatives: ['hola', 'hi'],
        metadata: { model: 'gpt-4', tokens: 42 },
      };

      const result = await service.completeDelegation('tenant-1', 'agent-target', 'req-1', complexOutput);
      expect(result.ok).toBe(true);

      const updated = await transport.getDelegationRequest('req-1');
      expect(updated!.output).toEqual(complexOutput);
    });

    it('should complete a request in executing status', async () => {
      setupAgent();
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      await transport.updateDelegationStatus('req-1', 'accepted');
      await transport.updateDelegationStatus('req-1', 'executing');

      const result = await service.completeDelegation('tenant-1', 'agent-target', 'req-1', {
        done: true,
      });
      expect(result.ok).toBe(true);
    });
  });

  // ─── acceptDelegations toggle ─────────────────────────

  describe('acceptDelegations toggle enforcement', () => {
    it('should reject all delegations when acceptDelegations is false', async () => {
      setupAgent('agent-target', { acceptDelegations: false });
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('does not accept');
    });

    it('should accept delegations when acceptDelegations is true', async () => {
      setupAgent('agent-target', { acceptDelegations: true });
      await createInboundRequest('agent-target', { requestId: 'req-1' });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(result.ok).toBe(true);
    });

    it('should reject when agent has no capabilities registered (no toggle)', async () => {
      // Don't set up any capabilities for this agent
      const anonId = anonIdManager.getOrRotateAnonymousId('tenant-1', 'agent-no-caps');
      await transport.sendDelegationRequest({
        requestId: 'req-1',
        requesterAnonymousId: 'requester-1',
        targetAnonymousId: anonId,
        taskType: 'translation',
        input: {},
        timeoutMs: 30000,
        status: 'request',
        createdAt: new Date().toISOString(),
      });

      const result = await service.acceptDelegation('tenant-1', 'agent-no-caps', 'req-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('does not accept');
    });
  });

  // ─── Full end-to-end flow ─────────────────────────────

  describe('end-to-end delegation flow', () => {
    it('should complete a full delegation: send → inbox → accept → complete → return', async () => {
      // Set up both agents
      setupAgent('agent-requester');
      const targetCap = setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');

      // 1. Requester sends delegation
      const delegatePromise = service.delegate('tenant-1', 'agent-requester', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 2000,
      });

      // 2. Target polls inbox
      await new Promise((r) => setTimeout(r, 30));
      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(1);

      // 3. Target accepts
      const acceptResult = await service.acceptDelegation(
        'tenant-1',
        'agent-target',
        inbox[0].requestId,
      );
      expect(acceptResult.ok).toBe(true);

      // 4. Target completes
      const completeResult = await service.completeDelegation(
        'tenant-1',
        'agent-target',
        inbox[0].requestId,
        { translated: 'hola' },
      );
      expect(completeResult.ok).toBe(true);

      // 5. Requester gets result
      const result = await delegatePromise;
      expect(result.status).toBe('success');
      expect(result.output).toEqual({ translated: 'hola' });
    });

    it('should handle rejection in end-to-end flow', async () => {
      setupAgent('agent-requester');
      setupAgent('agent-target');
      const targetAnonId = getAnonId('agent-target');

      const delegatePromise = service.delegate('tenant-1', 'agent-requester', {
        targetAnonymousId: targetAnonId,
        taskType: 'translation',
        input: { text: 'hello' },
        timeoutMs: 2000,
      });

      await new Promise((r) => setTimeout(r, 30));
      const inbox = await service.getInbox('tenant-1', 'agent-target');

      await service.rejectDelegation('tenant-1', 'agent-target', inbox[0].requestId);

      const result = await delegatePromise;
      expect(result.status).toBe('rejected');
    });
  });

  // ─── Inbound rate limiting ────────────────────────────

  describe('inbound rate limiting', () => {
    it('should enforce configured inbound rate limit', async () => {
      const cap = setupAgent();
      discoveryService.updateAgentPermissions('tenant-1', cap.id, { inboundRateLimit: 1 });

      // First should succeed
      await createInboundRequest('agent-target', { requestId: 'req-1' });
      const r1 = await service.acceptDelegation('tenant-1', 'agent-target', 'req-1');
      expect(r1.ok).toBe(true);

      // Second should be rate limited
      await createInboundRequest('agent-target', { requestId: 'req-2' });
      const r2 = await service.acceptDelegation('tenant-1', 'agent-target', 'req-2');
      expect(r2.ok).toBe(false);
      expect(r2.error).toContain('rate limit');
    });

    it('should use default rate limit when not configured', async () => {
      setupAgent(); // default inboundRateLimit = 10

      // Should allow at least a few
      for (let i = 0; i < 5; i++) {
        await createInboundRequest('agent-target', { requestId: `req-${i}` });
        const r = await service.acceptDelegation('tenant-1', 'agent-target', `req-${i}`);
        expect(r.ok).toBe(true);
      }
    });
  });

  // ─── Accept timeout ───────────────────────────────────

  describe('accept timeout', () => {
    it('should auto-reject requests older than acceptTimeoutMs in inbox', async () => {
      setupAgent();

      const oldTime = new Date(Date.now() - 600).toISOString(); // 600ms ago, timeout is 500ms
      await createInboundRequest('agent-target', {
        requestId: 'old-req',
        createdAt: oldTime,
      });

      const inbox = await service.getInbox('tenant-1', 'agent-target');
      expect(inbox).toHaveLength(0);

      const req = await transport.getDelegationRequest('old-req');
      expect(req!.status).toBe('timeout');
    });

    it('should reject accept attempt after timeout', async () => {
      setupAgent();

      const oldTime = new Date(Date.now() - 600).toISOString();
      await createInboundRequest('agent-target', {
        requestId: 'old-req',
        createdAt: oldTime,
      });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'old-req');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should accept requests within timeout window', async () => {
      setupAgent();

      await createInboundRequest('agent-target', {
        requestId: 'fresh-req',
        createdAt: new Date().toISOString(),
      });

      const result = await service.acceptDelegation('tenant-1', 'agent-target', 'fresh-req');
      expect(result.ok).toBe(true);
    });
  });
});
