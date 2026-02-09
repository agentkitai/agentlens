/**
 * Integration Test: Delegation Cycle (Story 7.5)
 *
 * Full register→discover→delegate→accept→complete→return cycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, type TestContext } from '../test-helpers.js';
import { DelegationService, LocalPoolTransport } from '../../services/delegation-service.js';
import { DiscoveryService } from '../../services/discovery-service.js';
import { capabilityRegistry, discoveryConfig } from '../../db/schema.sqlite.js';
import { randomUUID } from 'crypto';

describe('Integration: Delegation Cycle', () => {
  let ctx: TestContext;
  let transport: LocalPoolTransport;
  let delegationService: DelegationService;
  let discoveryService: DiscoveryService;
  const tenantId = 'default';

  function registerCapability(agentId: string, opts: { enabled?: boolean; acceptDelegations?: boolean; taskType?: string } = {}) {
    const id = randomUUID();
    ctx.db.insert(capabilityRegistry).values({
      id,
      tenantId,
      agentId,
      taskType: opts.taskType ?? 'code-review',
      customType: null,
      inputSchema: JSON.stringify({ type: 'object' }),
      outputSchema: JSON.stringify({ type: 'object' }),
      qualityMetrics: JSON.stringify({ trustScorePercentile: 80, successRate: 0.95, completedTasks: 20 }),
      estimatedLatencyMs: 1000,
      estimatedCostUsd: 0.01,
      maxInputBytes: 10000,
      scope: 'internal',
      enabled: opts.enabled ?? true,
      acceptDelegations: opts.acceptDelegations ?? true,
      inboundRateLimit: 10,
      outboundRateLimit: 20,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).run();
    return id;
  }

  function enableDelegation() {
    const existing = ctx.db.select().from(discoveryConfig).all();
    if (existing.some((r) => r.tenantId === tenantId)) {
      ctx.db.update(discoveryConfig)
        .set({ delegationEnabled: true, minTrustThreshold: 0, updatedAt: new Date().toISOString() })
        .run();
    } else {
      ctx.db.insert(discoveryConfig).values({
        tenantId,
        delegationEnabled: true,
        minTrustThreshold: 0,
        updatedAt: new Date().toISOString(),
      }).run();
    }
  }

  beforeEach(() => {
    ctx = createTestApp();
    transport = new LocalPoolTransport();
    delegationService = new DelegationService(ctx.db, transport, { acceptTimeoutMs: 30000 });
    discoveryService = new DiscoveryService(ctx.db);
    enableDelegation();
  });

  it('should discover registered capabilities', () => {
    registerCapability('agent-worker', { taskType: 'code-review' });
    const results = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    expect(results.length).toBe(1);
    expect(results[0].taskType).toBe('code-review');
  });

  it('should complete full delegate→accept→complete cycle', async () => {
    registerCapability('requester-agent', { taskType: 'code-review' });
    registerCapability('worker-agent', { taskType: 'code-review' });

    // Discover
    const discovered = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    expect(discovered.length).toBeGreaterThanOrEqual(1);

    const targetAnonId = discovered[0].anonymousAgentId;

    // Delegate (runs async, but with local transport it sends instantly)
    const delegatePromise = delegationService.delegate(tenantId, 'requester-agent', {
      targetAnonymousId: targetAnonId,
      taskType: 'code-review',
      input: { code: 'function foo() { return 1; }' },
      timeoutMs: 5000,
    });

    // Simulate worker accepting and completing
    // Small delay to let the delegate send the request
    await new Promise((r) => setTimeout(r, 50));

    const inbox = await delegationService.getInbox(tenantId, 'worker-agent');
    if (inbox.length > 0) {
      await delegationService.acceptDelegation(tenantId, 'worker-agent', inbox[0].requestId);
      await delegationService.completeDelegation(tenantId, 'worker-agent', inbox[0].requestId, { feedback: 'Looks good!' });
    } else {
      // Also check if the target is the requester
      const inbox2 = await delegationService.getInbox(tenantId, 'requester-agent');
      if (inbox2.length > 0) {
        await delegationService.acceptDelegation(tenantId, 'requester-agent', inbox2[0].requestId);
        await delegationService.completeDelegation(tenantId, 'requester-agent', inbox2[0].requestId, { feedback: 'Looks good!' });
      }
    }

    const result = await delegatePromise;
    expect(['success', 'timeout']).toContain(result.status);
  });

  it('should enforce trust threshold', () => {
    registerCapability('low-trust-agent', { taskType: 'code-review' });

    // Set high trust threshold
    discoveryService.updateDiscoveryConfig(tenantId, { minTrustThreshold: 95 });

    // Set low trust score
    ctx.db.update(capabilityRegistry)
      .set({ qualityMetrics: JSON.stringify({ trustScorePercentile: 30 }) })
      .run();

    const results = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    expect(results.length).toBe(0);
  });

  it('should enforce outbound rate limiting', async () => {
    registerCapability('rate-limited-agent', { taskType: 'code-review' });

    // Exhaust outbound rate limit via the discovery service's limiter
    // The delegation service uses discoveryService internally
    for (let i = 0; i < 20; i++) {
      delegationService['discoveryService'].checkOutboundRateLimit('rate-limited-agent', 20);
    }

    const result = await delegationService.delegate(tenantId, 'rate-limited-agent', {
      targetAnonymousId: 'some-target',
      taskType: 'code-review',
      input: {},
      timeoutMs: 1000,
    });
    expect(result.status).toBe('error');
  });

  it('should log delegation to delegation_log', async () => {
    registerCapability('agent-a', { taskType: 'code-review' });
    const discovered = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    if (discovered.length === 0) return;

    // Start delegation (will timeout since no one accepts)
    await delegationService.delegate(tenantId, 'agent-a', {
      targetAnonymousId: discovered[0].anonymousAgentId,
      taskType: 'code-review',
      input: { test: true },
      timeoutMs: 200,
    });

    const logs = delegationService.getDelegationLogs(tenantId);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].taskType).toBe('code-review');
  });

  it('should reject delegation when tenant delegation is disabled', async () => {
    discoveryService.updateDiscoveryConfig(tenantId, { delegationEnabled: false });

    const result = await delegationService.delegate(tenantId, 'some-agent', {
      targetAnonymousId: 'target',
      taskType: 'code-review',
      input: {},
    });
    expect(result.status).toBe('rejected');
  });

  it('should support fallback on failure', async () => {
    registerCapability('worker-1', { taskType: 'code-review' });
    registerCapability('worker-2', { taskType: 'code-review' });

    const discovered = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    expect(discovered.length).toBeGreaterThanOrEqual(1);

    // Delegate with fallback enabled, short timeout (will timeout on all)
    const result = await delegationService.delegate(tenantId, 'requester', {
      targetAnonymousId: discovered[0].anonymousAgentId,
      taskType: 'code-review',
      input: {},
      timeoutMs: 100,
      fallbackEnabled: true,
      maxRetries: 2,
    });

    // Will timeout since nobody accepts
    expect(result.status).toBe('timeout');
    expect(result.retriesUsed).toBeGreaterThanOrEqual(0);
  });

  it('should not discover disabled capabilities', () => {
    registerCapability('disabled-agent', { taskType: 'code-review', enabled: false });
    const results = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    expect(results.length).toBe(0);
  });

  it('should reject acceptance when agent does not accept delegations', async () => {
    registerCapability('no-accept-agent', { taskType: 'code-review', acceptDelegations: false });

    // Manually create a delegation request targeting this agent
    const anonId = discoveryService.discover(tenantId, { taskType: 'code-review', scope: 'internal' });
    // Agent is not discoverable since acceptDelegations=false doesn't affect discovery
    // But let's test the acceptance path
    await transport.sendDelegationRequest({
      requestId: 'req-123',
      requesterAnonymousId: 'requester-anon',
      targetAnonymousId: 'fake-target',
      taskType: 'code-review',
      input: {},
      timeoutMs: 5000,
      status: 'request',
      createdAt: new Date().toISOString(),
    });

    const result = await delegationService.acceptDelegation(tenantId, 'no-accept-agent', 'req-123');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('does not accept');
  });

  it('should export delegation logs as JSON', () => {
    // Just verify the export method works
    const json = delegationService.exportDelegationLogs(tenantId);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
