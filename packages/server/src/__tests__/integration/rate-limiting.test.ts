/**
 * Integration Test: Rate Limiting (Story 7.5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, type TestContext } from '../test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../../services/community-service.js';
import { DelegationService, LocalPoolTransport } from '../../services/delegation-service.js';
import { DiscoveryService } from '../../services/discovery-service.js';
import { LessonStore } from '../../db/lesson-store.js';
import { capabilityRegistry, discoveryConfig } from '../../db/schema.sqlite.js';
import { randomUUID } from 'crypto';

describe('Integration: Rate Limiting', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
  });

  function createLesson(tenantId: string) {
    return lessonStore.create(tenantId, {
      title: 'Rate limit test lesson',
      content: 'Safe content for rate limiting tests.',
      category: 'error-patterns',
    } as any);
  }

  // ─── Sharing Rate Limiting (50/hr) ────────────────

  describe('Sharing rate limiting', () => {
    it('should allow shares within rate limit', async () => {
      const transport = new LocalCommunityPoolTransport();
      const service = new CommunityService(ctx.db, { transport });
      service.updateSharingConfig('rate-tenant', { enabled: true, rateLimitPerHour: 5 });

      for (let i = 0; i < 5; i++) {
        const lesson = createLesson('rate-tenant');
        const result = await service.share('rate-tenant', lesson.id, 'agent');
        expect(result.status).toBe('shared');
      }
    });

    it('should block shares after exceeding rate limit', async () => {
      const transport = new LocalCommunityPoolTransport();
      const service = new CommunityService(ctx.db, { transport });
      service.updateSharingConfig('rate-tenant', { enabled: true, rateLimitPerHour: 3 });

      for (let i = 0; i < 3; i++) {
        const lesson = createLesson('rate-tenant');
        await service.share('rate-tenant', lesson.id, 'agent');
      }

      const lesson = createLesson('rate-tenant');
      const result = await service.share('rate-tenant', lesson.id, 'agent');
      expect(result.status).toBe('rate_limited');
    });

    it('should use custom rate limit from config', async () => {
      const transport = new LocalCommunityPoolTransport();
      const service = new CommunityService(ctx.db, { transport });
      service.updateSharingConfig('custom-rate', { enabled: true, rateLimitPerHour: 2 });

      const l1 = createLesson('custom-rate');
      const l2 = createLesson('custom-rate');
      const l3 = createLesson('custom-rate');

      await service.share('custom-rate', l1.id, 'agent');
      await service.share('custom-rate', l2.id, 'agent');
      const result = await service.share('custom-rate', l3.id, 'agent');
      expect(result.status).toBe('rate_limited');
    });

    it('should rate limit per tenant independently', async () => {
      const transport = new LocalCommunityPoolTransport();
      const service = new CommunityService(ctx.db, { transport });
      service.updateSharingConfig('tenant-x', { enabled: true, rateLimitPerHour: 1 });
      service.updateSharingConfig('tenant-y', { enabled: true, rateLimitPerHour: 1 });

      const lx = createLesson('tenant-x');
      const ly = createLesson('tenant-y');

      const r1 = await service.share('tenant-x', lx.id, 'agent');
      expect(r1.status).toBe('shared');

      const r2 = await service.share('tenant-y', ly.id, 'agent');
      expect(r2.status).toBe('shared');
    });

    it('should log rate limit events in audit', async () => {
      const transport = new LocalCommunityPoolTransport();
      const service = new CommunityService(ctx.db, { transport });
      service.updateSharingConfig('audit-rate', { enabled: true, rateLimitPerHour: 1 });

      const l1 = createLesson('audit-rate');
      const l2 = createLesson('audit-rate');
      await service.share('audit-rate', l1.id, 'agent');
      await service.share('audit-rate', l2.id, 'agent');

      const audit = service.getAuditLog('audit-rate');
      expect(audit.some((e) => e.eventType === 'rate')).toBe(true);
    });
  });

  // ─── Delegation Rate Limiting ─────────────────────

  describe('Delegation rate limiting', () => {
    function setupDelegation() {
      const transport = new LocalPoolTransport();
      const service = new DelegationService(ctx.db, transport, { acceptTimeoutMs: 30000 });
      const discovery = new DiscoveryService(ctx.db);

      ctx.db.insert(discoveryConfig).values({
        tenantId: 'default',
        delegationEnabled: true,
        minTrustThreshold: 0,
        updatedAt: new Date().toISOString(),
      }).run();

      return { transport, service, discovery };
    }

    function registerCap(agentId: string, limits: { inbound?: number; outbound?: number } = {}) {
      ctx.db.insert(capabilityRegistry).values({
        id: randomUUID(),
        tenantId: 'default',
        agentId,
        taskType: 'code-review',
        customType: null,
        inputSchema: '{}',
        outputSchema: '{}',
        qualityMetrics: JSON.stringify({ trustScorePercentile: 80 }),
        estimatedLatencyMs: 1000,
        estimatedCostUsd: 0.01,
        maxInputBytes: 10000,
        scope: 'internal',
        enabled: true,
        acceptDelegations: true,
        inboundRateLimit: limits.inbound ?? 10,
        outboundRateLimit: limits.outbound ?? 20,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).run();
    }

    it('should enforce inbound rate limit (10/min default)', () => {
      const { discovery } = setupDelegation();
      registerCap('target-agent', { inbound: 3 });

      // Exhaust inbound rate limit
      for (let i = 0; i < 3; i++) {
        expect(discovery.checkInboundRateLimit('target-agent', 3)).toBe(true);
      }
      expect(discovery.checkInboundRateLimit('target-agent', 3)).toBe(false);
    });

    it('should enforce outbound rate limit (20/min default)', () => {
      const { discovery } = setupDelegation();
      registerCap('source-agent', { outbound: 3 });

      for (let i = 0; i < 3; i++) {
        expect(discovery.checkOutboundRateLimit('source-agent', 3)).toBe(true);
      }
      expect(discovery.checkOutboundRateLimit('source-agent', 3)).toBe(false);
    });

    it('should reject delegation when outbound limit exceeded', async () => {
      const { service } = setupDelegation();
      registerCap('fast-agent', { outbound: 1 });

      // First delegation consumes the limit
      await service.delegate('default', 'fast-agent', {
        targetAnonymousId: 'some-target',
        taskType: 'code-review',
        input: {},
        timeoutMs: 100,
      });

      // Second should be rate limited
      const result = await service.delegate('default', 'fast-agent', {
        targetAnonymousId: 'some-target',
        taskType: 'code-review',
        input: {},
        timeoutMs: 100,
      });
      expect(result.status).toBe('error');
    });
  });
});
