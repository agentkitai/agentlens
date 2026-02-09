/**
 * Integration Test: Toggle Enforcement (Story 7.5)
 *
 * Verify hierarchical toggle enforcement at all levels.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, type TestContext } from '../test-helpers.js';
import { CommunityService, LocalCommunityPoolTransport } from '../../services/community-service.js';
import { LessonStore } from '../../db/lesson-store.js';

describe('Integration: Toggle Enforcement', () => {
  let ctx: TestContext;
  let lessonStore: LessonStore;
  let transport: LocalCommunityPoolTransport;
  let service: CommunityService;
  const tenantId = 'toggle-tenant';

  beforeEach(() => {
    ctx = createTestApp();
    lessonStore = new LessonStore(ctx.db);
    transport = new LocalCommunityPoolTransport();
    service = new CommunityService(ctx.db, { transport });
  });

  function createLesson(overrides: Record<string, unknown> = {}) {
    return lessonStore.create(tenantId, {
      title: 'Test lesson',
      content: 'Safe content about error handling patterns.',
      category: 'error-patterns',
      ...overrides,
    } as any);
  }

  // ─── Tenant-level toggle ──────────────────────────

  it('should block sharing when tenant is OFF', async () => {
    service.updateSharingConfig(tenantId, { enabled: false });
    const lesson = createLesson();
    const result = await service.share(tenantId, lesson.id, 'agent');
    expect(result.status).toBe('disabled');
  });

  it('should allow sharing when tenant is ON', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    const lesson = createLesson();
    const result = await service.share(tenantId, lesson.id, 'agent');
    expect(result.status).toBe('shared');
  });

  it('should block everything when tenant toggle is OFF even with agent ON', async () => {
    service.updateSharingConfig(tenantId, { enabled: false });
    service.updateAgentSharingConfig(tenantId, 'agent-1', {
      enabled: true,
      categories: ['error-patterns'],
    });
    const lesson = createLesson({ agentId: 'agent-1' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('disabled');
  });

  // ─── Agent-level toggle ───────────────────────────

  it('should block sharing when agent is OFF', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.updateAgentSharingConfig(tenantId, 'agent-1', { enabled: false });
    const lesson = createLesson({ agentId: 'agent-1' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('disabled');
  });

  it('should allow sharing when agent is ON', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.updateAgentSharingConfig(tenantId, 'agent-1', {
      enabled: true,
      categories: ['error-patterns'],
    });
    const lesson = createLesson({ agentId: 'agent-1' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('shared');
  });

  // ─── Category-level toggle ────────────────────────

  it('should block sharing for disabled category', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.updateAgentSharingConfig(tenantId, 'agent-1', {
      enabled: true,
      categories: ['debugging'],  // Only debugging, not error-patterns
    });
    const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('disabled');
    if (result.status === 'disabled') {
      expect(result.reason).toContain('Category');
    }
  });

  it('should allow sharing for enabled category', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.updateAgentSharingConfig(tenantId, 'agent-1', {
      enabled: true,
      categories: ['error-patterns'],
    });
    const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('shared');
  });

  it('should allow all categories when categories list is empty', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.updateAgentSharingConfig(tenantId, 'agent-1', {
      enabled: true,
      categories: [],
    });
    const lesson = createLesson({ agentId: 'agent-1', category: 'error-patterns' });
    const result = await service.share(tenantId, lesson.id, 'agent-1');
    expect(result.status).toBe('shared');
  });

  // ─── Deny list ────────────────────────────────────

  it('should block sharing when content matches deny-list pattern', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.addDenyListRule(tenantId, 'proprietary-algorithm', false, 'Trade secret');

    const lesson = createLesson({
      content: 'This uses our proprietary-algorithm for optimization.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    expect(result.status).toBe('blocked');
  });

  it('should block sharing when content matches deny-list regex', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    // The SemanticDenyListLayer expects regex in /pattern/flags format
    service.addDenyListRule(tenantId, '/project-\\d+/', true, 'Internal project ref');

    const lesson = createLesson({
      content: 'As we found in project-42, the approach works better.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    expect(result.status).toBe('blocked');
  });

  it('should allow sharing when content does not match deny-list', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    service.addDenyListRule(tenantId, 'secret-stuff', false, 'Confidential');

    const lesson = createLesson({
      content: 'General error handling patterns are useful.',
    });
    const result = await service.share(tenantId, lesson.id, 'agent');
    expect(result.status).toBe('shared');
  });

  it('should enforce deny-list after adding rule dynamically', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });

    const lesson = createLesson({ content: 'Use the alpha-protocol for this.' });

    // Share succeeds before deny-list rule
    const result1 = await service.share(tenantId, lesson.id, 'agent');
    expect(result1.status).toBe('shared');

    // Add deny-list rule
    service.addDenyListRule(tenantId, 'alpha-protocol', false, 'Internal name');

    // Share now fails
    const result2 = await service.share(tenantId, lesson.id, 'agent');
    expect(result2.status).toBe('blocked');
  });

  it('should stop enforcing deny-list after removing rule', async () => {
    service.updateSharingConfig(tenantId, { enabled: true });
    const rule = service.addDenyListRule(tenantId, 'beta-protocol', false, 'Internal');

    const lesson = createLesson({ content: 'Use beta-protocol for testing.' });
    const result1 = await service.share(tenantId, lesson.id, 'agent');
    expect(result1.status).toBe('blocked');

    // Remove rule
    service.deleteDenyListRule(tenantId, rule.id);

    const result2 = await service.share(tenantId, lesson.id, 'agent');
    expect(result2.status).toBe('shared');
  });
});
