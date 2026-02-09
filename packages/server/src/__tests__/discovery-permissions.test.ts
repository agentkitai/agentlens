/**
 * Tests for Permission Model (Story 5.4)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { CapabilityStore } from '../db/capability-store.js';
import { DiscoveryService, RateLimiter } from '../services/discovery-service.js';
import type { SqliteDb } from '../db/index.js';

describe('Permission Model (Story 5.4)', () => {
  let db: SqliteDb;
  let capStore: CapabilityStore;
  let service: DiscoveryService;

  const baseInput = {
    taskType: 'translation',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { translated: { type: 'string' } } },
  };

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);
    capStore = new CapabilityStore(db);
    service = new DiscoveryService(db);
  });

  // ─── Opt-in Discovery ─────────────────────────────────

  describe('opt-in discovery (enabled field)', () => {
    it('should default enabled to true on creation (schema default)', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      expect(cap.enabled).toBe(true);
    });

    it('should not return disabled capabilities in discovery', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: false });
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 0 });

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(0);
    });

    it('should return enabled capabilities in discovery', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      // enabled is true by default
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 0 });

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(1);
    });

    it('should toggle enabled on and off', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 0 });

      // Disable
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: false });
      let results = service.discover('tenant-1', { taskType: 'translation', scope: 'internal' });
      expect(results).toHaveLength(0);

      // Re-enable
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: true });
      results = service.discover('tenant-1', { taskType: 'translation', scope: 'internal' });
      expect(results).toHaveLength(1);
    });
  });

  // ─── Opt-in Delegation Acceptance ─────────────────────

  describe('acceptDelegations field', () => {
    it('should default acceptDelegations to false', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      expect(cap.acceptDelegations).toBe(false);
    });

    it('should allow updating acceptDelegations', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-1', cap.id, { acceptDelegations: true });

      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated!.acceptDelegations).toBe(true);
    });

    it('should allow toggling acceptDelegations off', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-1', cap.id, { acceptDelegations: true });
      service.updateAgentPermissions('tenant-1', cap.id, { acceptDelegations: false });

      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated!.acceptDelegations).toBe(false);
    });
  });

  // ─── Admin Controls for Delegation ────────────────────

  describe('admin delegation controls (tenant-wide)', () => {
    it('should default delegationEnabled to false', () => {
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.delegationEnabled).toBe(false);
    });

    it('should allow enabling delegation tenant-wide', () => {
      service.updateDiscoveryConfig('tenant-1', { delegationEnabled: true });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.delegationEnabled).toBe(true);
    });

    it('should allow disabling delegation tenant-wide', () => {
      service.updateDiscoveryConfig('tenant-1', { delegationEnabled: true });
      service.updateDiscoveryConfig('tenant-1', { delegationEnabled: false });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.delegationEnabled).toBe(false);
    });
  });

  // ─── Trust Threshold ──────────────────────────────────

  describe('tenant-wide minimum trust threshold', () => {
    it('should default trust threshold to 60', () => {
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.minTrustThreshold).toBe(60);
    });

    it('should enforce trust threshold in discovery', () => {
      // Cap with trust 50 — below default threshold of 60
      const cap = capStore.create('tenant-1', 'agent-1', {
        ...baseInput,
        qualityMetrics: { trustScorePercentile: 50 },
      } as any);
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: true });

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(0);
    });

    it('should allow capabilities above trust threshold', () => {
      const cap = capStore.create('tenant-1', 'agent-1', {
        ...baseInput,
        qualityMetrics: { trustScorePercentile: 80 },
      } as any);
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: true });

      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
      });
      expect(results).toHaveLength(1);
    });

    it('should allow updating trust threshold', () => {
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 30 });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.minTrustThreshold).toBe(30);
    });

    it('should use updated trust threshold in discovery', () => {
      const cap = capStore.create('tenant-1', 'agent-1', {
        ...baseInput,
        qualityMetrics: { trustScorePercentile: 50 },
      } as any);
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: true });

      // Default threshold 60, should be excluded
      let results = service.discover('tenant-1', { taskType: 'translation', scope: 'internal' });
      expect(results).toHaveLength(0);

      // Lower threshold to 40
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 40 });
      results = service.discover('tenant-1', { taskType: 'translation', scope: 'internal' });
      expect(results).toHaveLength(1);
    });

    it('should use the higher of query minTrust and tenant threshold', () => {
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 30 });

      const cap = capStore.create('tenant-1', 'agent-1', {
        ...baseInput,
        qualityMetrics: { trustScorePercentile: 50 },
      } as any);
      service.updateAgentPermissions('tenant-1', cap.id, { enabled: true });

      // Query minTrust=70 > tenant threshold=30
      const results = service.discover('tenant-1', {
        taskType: 'translation',
        scope: 'internal',
        minTrustScore: 70,
      });
      expect(results).toHaveLength(0);
    });
  });

  // ─── Rate Limiting ────────────────────────────────────

  describe('rate limiting', () => {
    it('should default inbound rate limit to 10/min', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      expect(cap.inboundRateLimit).toBe(10);
    });

    it('should default outbound rate limit to 20/min', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      expect(cap.outboundRateLimit).toBe(20);
    });

    it('should allow within inbound rate limit', () => {
      for (let i = 0; i < 10; i++) {
        expect(service.checkInboundRateLimit('agent-1', 10)).toBe(true);
      }
    });

    it('should block when inbound rate limit exceeded', () => {
      for (let i = 0; i < 10; i++) {
        service.checkInboundRateLimit('agent-1', 10);
      }
      expect(service.checkInboundRateLimit('agent-1', 10)).toBe(false);
    });

    it('should allow within outbound rate limit', () => {
      for (let i = 0; i < 20; i++) {
        expect(service.checkOutboundRateLimit('agent-1', 20)).toBe(true);
      }
    });

    it('should block when outbound rate limit exceeded', () => {
      for (let i = 0; i < 20; i++) {
        service.checkOutboundRateLimit('agent-1', 20);
      }
      expect(service.checkOutboundRateLimit('agent-1', 20)).toBe(false);
    });

    it('should allow configuring per-agent rate limits', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-1', cap.id, {
        inboundRateLimit: 5,
        outboundRateLimit: 50,
      });

      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated!.inboundRateLimit).toBe(5);
      expect(updated!.outboundRateLimit).toBe(50);
    });

    it('should track rate limits per agent independently', () => {
      // Exhaust agent-1's limit
      for (let i = 0; i < 10; i++) {
        service.checkInboundRateLimit('agent-1', 10);
      }
      expect(service.checkInboundRateLimit('agent-1', 10)).toBe(false);

      // agent-2 should still be fine
      expect(service.checkInboundRateLimit('agent-2', 10)).toBe(true);
    });
  });

  // ─── RateLimiter unit tests ───────────────────────────

  describe('RateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = new RateLimiter();
    });

    it('should allow first request', () => {
      expect(limiter.check('key', 5)).toBe(true);
    });

    it('should allow up to limit', () => {
      for (let i = 0; i < 5; i++) {
        expect(limiter.check('key', 5)).toBe(true);
      }
    });

    it('should block after limit exceeded', () => {
      for (let i = 0; i < 5; i++) {
        limiter.check('key', 5);
      }
      expect(limiter.check('key', 5)).toBe(false);
    });

    it('should track different keys independently', () => {
      for (let i = 0; i < 5; i++) {
        limiter.check('key-a', 5);
      }
      expect(limiter.check('key-a', 5)).toBe(false);
      expect(limiter.check('key-b', 5)).toBe(true);
    });

    it('should reset when calling reset()', () => {
      for (let i = 0; i < 5; i++) {
        limiter.check('key', 5);
      }
      limiter.reset();
      expect(limiter.check('key', 5)).toBe(true);
    });
  });

  // ─── Per-Agent Permission Updates ─────────────────────

  describe('updateAgentPermissions', () => {
    it('should return false for non-existent capability', () => {
      const ok = service.updateAgentPermissions('tenant-1', 'nonexistent', { enabled: true });
      expect(ok).toBe(false);
    });

    it('should return true for existing capability', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      const ok = service.updateAgentPermissions('tenant-1', cap.id, { enabled: false });
      expect(ok).toBe(true);
    });

    it('should not update capabilities from other tenants', () => {
      const cap = capStore.create('tenant-2', 'agent-1', baseInput as any);
      const ok = service.updateAgentPermissions('tenant-1', cap.id, { enabled: false });
      expect(ok).toBe(false);
    });

    it('should update multiple fields at once', () => {
      const cap = capStore.create('tenant-1', 'agent-1', baseInput as any);
      service.updateAgentPermissions('tenant-1', cap.id, {
        enabled: false,
        acceptDelegations: true,
        inboundRateLimit: 5,
        outboundRateLimit: 50,
      });

      const updated = capStore.getById('tenant-1', cap.id);
      expect(updated!.enabled).toBe(false);
      expect(updated!.acceptDelegations).toBe(true);
      expect(updated!.inboundRateLimit).toBe(5);
      expect(updated!.outboundRateLimit).toBe(50);
    });
  });

  // ─── Discovery Config CRUD ────────────────────────────

  describe('discoveryConfig', () => {
    it('should return defaults for unconfigured tenant', () => {
      const config = service.getDiscoveryConfig('new-tenant');
      expect(config.tenantId).toBe('new-tenant');
      expect(config.minTrustThreshold).toBe(60);
      expect(config.delegationEnabled).toBe(false);
    });

    it('should persist config updates', () => {
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 80, delegationEnabled: true });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.minTrustThreshold).toBe(80);
      expect(config.delegationEnabled).toBe(true);
    });

    it('should allow partial updates', () => {
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 80 });
      service.updateDiscoveryConfig('tenant-1', { delegationEnabled: true });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.minTrustThreshold).toBe(80);
      expect(config.delegationEnabled).toBe(true);
    });

    it('should set updatedAt on config changes', () => {
      service.updateDiscoveryConfig('tenant-1', { minTrustThreshold: 80 });
      const config = service.getDiscoveryConfig('tenant-1');
      expect(config.updatedAt).toBeDefined();
    });
  });
});
