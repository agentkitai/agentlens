/**
 * Integration Test: Privacy Guarantees (Story 7.5)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, type TestContext } from '../test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../../services/community-service.js';
import { LessonStore } from '../../db/lesson-store.js';
import { AnonymousIdManager } from '../../db/anonymous-id-manager.js';

describe('Integration: Privacy Guarantees', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;
  const tenantId = 'privacy-tenant';

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(ctx.db, { transport });
    service.updateSharingConfig(tenantId, { enabled: true });
  });

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create(tenantId, {
      title: 'Privacy test lesson',
      content: 'Generic safe content about patterns.',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  // ─── Anonymous ID Rotation ────────────────────────

  it('should return same anonymous ID within 24h', () => {
    const manager = new AnonymousIdManager(ctx.db);
    const id1 = manager.getOrRotateAnonymousId(tenantId, 'agent-1');
    const id2 = manager.getOrRotateAnonymousId(tenantId, 'agent-1');
    expect(id1).toBe(id2);
  });

  it('should rotate anonymous ID after 24h', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const manager = new AnonymousIdManager(ctx.db, { now: () => now });

    const id1 = manager.getOrRotateAnonymousId(tenantId, 'agent-1');

    // Move time forward 25 hours
    now = new Date('2026-01-02T01:00:00Z');
    const id2 = manager.getOrRotateAnonymousId(tenantId, 'agent-1');

    expect(id2).not.toBe(id1);
  });

  it('should keep old IDs for audit trail after rotation', () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const manager = new AnonymousIdManager(ctx.db, { now: () => now });

    manager.getOrRotateAnonymousId(tenantId, 'agent-1');
    now = new Date('2026-01-02T01:00:00Z');
    manager.getOrRotateAnonymousId(tenantId, 'agent-1');

    const trail = manager.getAuditTrail(tenantId, 'agent-1');
    expect(trail.length).toBe(2);
  });

  it('should generate different IDs for different agents', () => {
    const manager = new AnonymousIdManager(ctx.db);
    const id1 = manager.getOrRotateAnonymousId(tenantId, 'agent-1');
    const id2 = manager.getOrRotateAnonymousId(tenantId, 'agent-2');
    expect(id1).not.toBe(id2);
  });

  it('should generate different IDs for different tenants', () => {
    const manager = new AnonymousIdManager(ctx.db);
    const id1 = manager.getOrRotateAnonymousId('tenant-a', 'agent-1');
    const id2 = manager.getOrRotateAnonymousId('tenant-b', 'agent-1');
    expect(id1).not.toBe(id2);
  });

  // ─── No Tenant Info in Pool Data ──────────────────

  it('should not include tenant ID in pool data', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'agent');

    for (const item of transport.shared) {
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain(tenantId);
    }
  });

  it('should not include agent ID in pool data', async () => {
    const lesson = createLesson({ agentId: 'my-secret-agent' });
    await service.share(tenantId, lesson.id, 'agent');

    for (const item of transport.shared) {
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain('my-secret-agent');
    }
  });

  // ─── Context Field Always Stripped ────────────────

  it('should strip context field before sharing', async () => {
    const lesson = createLesson({
      context: { apiKey: 'secret123', projectId: 'proj-99' },
    });
    await service.share(tenantId, lesson.id, 'agent');

    for (const item of transport.shared) {
      expect(item.content).not.toContain('secret123');
      expect(item.content).not.toContain('proj-99');
    }
  });

  it('should strip nested context data', async () => {
    const lesson = createLesson({
      context: { deep: { nested: { secret: 'top-secret-value' } } },
    });
    await service.share(tenantId, lesson.id, 'agent');

    for (const item of transport.shared) {
      expect(item.content).not.toContain('top-secret-value');
    }
  });

  // ─── Redaction Applied Before Sharing ─────────────

  it('should redact PII (email) before sharing', async () => {
    const lesson = createLesson({
      content: 'Contact john.doe@example.com for help with this pattern.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');

    if (result.status === 'shared') {
      const poolContent = transport.shared[0]?.content ?? '';
      expect(poolContent).not.toContain('john.doe@example.com');
    }
  });

  it('should redact AWS keys before sharing', async () => {
    const lesson = createLesson({
      content: 'Use AKIAIOSFODNN7EXAMPLE as the access key.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    // Should be blocked or redacted
    if (result.status === 'shared') {
      expect(result.redactionFindings.length).toBeGreaterThan(0);
      const poolContent = transport.shared[transport.shared.length - 1]?.content ?? '';
      expect(poolContent).not.toContain('AKIAIOSFODNN7EXAMPLE');
    }
  });

  it('should redact file paths before sharing', async () => {
    const lesson = createLesson({
      content: 'The config is at /home/user/.ssh/config and /etc/passwd.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    if (result.status === 'shared') {
      const poolContent = transport.shared[transport.shared.length - 1]?.content ?? '';
      expect(poolContent).not.toContain('/home/user/.ssh/config');
    }
  });

  it('should redact private IPs before sharing', async () => {
    const lesson = createLesson({
      content: 'Connect to 192.168.1.100 for the internal service.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    if (result.status === 'shared') {
      const poolContent = transport.shared[transport.shared.length - 1]?.content ?? '';
      expect(poolContent).not.toContain('192.168.1.100');
    }
  });

  // ─── No Identity Leakage in Search Results ────────

  it('should not leak contributor identity in search results', async () => {
    const lesson = createLesson();
    await service.share(tenantId, lesson.id, 'agent');

    const results = await service.search('other-tenant', 'pattern');
    for (const item of results.lessons) {
      const serialized = JSON.stringify(item);
      expect(serialized).not.toContain(tenantId);
      expect(serialized).not.toContain('agent');
    }
  });

  it('should use UUID format for anonymous IDs', () => {
    const manager = new AnonymousIdManager(ctx.db);
    const id = manager.getOrRotateAnonymousId(tenantId, 'test-agent');
    // UUID v4 format
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
