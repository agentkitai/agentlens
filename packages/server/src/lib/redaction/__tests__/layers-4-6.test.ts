/**
 * Tests for Redaction Layers 4-6 (Story 2.2)
 * TenantDeidentificationLayer, SemanticDenyListLayer, HumanReviewLayer
 */

import { describe, it, expect, vi } from 'vitest';
import { TenantDeidentificationLayer } from '../tenant-deidentification-layer.js';
import { SemanticDenyListLayer } from '../semantic-denylist-layer.js';
import { HumanReviewLayer, type ReviewQueueStore } from '../human-review-layer.js';
import type { RedactionContext } from '@agentlensai/core';

const baseCtx: RedactionContext = {
  tenantId: 'test-tenant',
  category: 'general',
  denyListPatterns: [],
  knownTenantTerms: [],
};

// ═══════════════════════════════════════════════════════════
// Layer 4: TenantDeidentificationLayer
// ═══════════════════════════════════════════════════════════

describe('TenantDeidentificationLayer', () => {
  const layer = new TenantDeidentificationLayer();

  it('has correct name and order', () => {
    expect(layer.name).toBe('tenant_deidentification');
    expect(layer.order).toBe(400);
  });

  it('strips tenant ID', () => {
    const ctx = { ...baseCtx, tenantId: 'acme-corp' };
    const result = layer.process('This lesson is from acme-corp environment', ctx);
    expect(result.output).toContain('[TENANT_ENTITY]');
    expect(result.output).not.toContain('acme-corp');
  });

  it('strips agent ID', () => {
    const ctx = { ...baseCtx, agentId: 'agent-alpha-v2' };
    const result = layer.process('agent-alpha-v2 discovered this pattern', ctx);
    expect(result.output).toContain('[TENANT_ENTITY]');
    expect(result.output).not.toContain('agent-alpha-v2');
  });

  it('strips known tenant terms', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['MegaCorp', 'Project Phoenix', 'John Smith'] };
    const result = layer.process('MegaCorp uses Project Phoenix, managed by John Smith', ctx);
    expect(result.output).not.toContain('MegaCorp');
    expect(result.output).not.toContain('Project Phoenix');
    expect(result.output).not.toContain('John Smith');
    expect(result.output.match(/\[TENANT_ENTITY\]/g)?.length).toBe(3);
  });

  it('is case-insensitive', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['MegaCorp'] };
    const result = layer.process('MEGACORP and megacorp both appear', ctx);
    expect(result.output).not.toContain('MEGACORP');
    expect(result.output).not.toContain('megacorp');
  });

  it('strips UUIDs', () => {
    const result = layer.process('User a1b2c3d4-e5f6-7890-abcd-ef1234567890 logged in', baseCtx);
    expect(result.output).toContain('[TENANT_ENTITY]');
    expect(result.output).not.toContain('a1b2c3d4');
  });

  it('strips multiple UUIDs', () => {
    const text = 'Session a1b2c3d4-e5f6-7890-abcd-ef1234567890 by f1e2d3c4-b5a6-7890-abcd-ef1234567890';
    const result = layer.process(text, baseCtx);
    expect(result.output.match(/\[TENANT_ENTITY\]/g)?.length).toBe(2);
  });

  it('ignores terms shorter than 3 chars', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['ab', 'x'] };
    const result = layer.process('ab and x should remain', ctx);
    expect(result.output).toBe('ab and x should remain');
  });

  it('passes through clean text', () => {
    const result = layer.process('This is a generic lesson about error handling.', baseCtx);
    expect(result.output).toBe('This is a generic lesson about error handling.');
    expect(result.findings).toHaveLength(0);
  });

  it('replaces longer terms first (no partial matches)', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['Acme Corporation', 'Acme'] };
    const result = layer.process('Acme Corporation is a company. Acme is short.', ctx);
    // "Acme Corporation" should be replaced first as a whole
    expect(result.output).not.toContain('Acme Corporation');
    expect(result.output).not.toContain('Acme');
  });

  it('produces correct findings', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['MegaCorp'] };
    const result = layer.process('MegaCorp rules', ctx);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const f = result.findings[0];
    expect(f.layer).toBe('tenant_deidentification');
    expect(f.replacement).toBe('[TENANT_ENTITY]');
  });

  it('never blocks', () => {
    const ctx = { ...baseCtx, knownTenantTerms: ['MegaCorp'] };
    const result = layer.process('MegaCorp secret stuff', ctx);
    expect(result.blocked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 5: SemanticDenyListLayer
// ═══════════════════════════════════════════════════════════

describe('SemanticDenyListLayer', () => {
  const layer = new SemanticDenyListLayer();

  it('has correct name and order', () => {
    expect(layer.name).toBe('semantic_denylist');
    expect(layer.order).toBe(500);
  });

  it('blocks on plain text match', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['Project X'] };
    const result = layer.process('This involves Project X details', ctx);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('Project X');
  });

  it('plain text match is case-insensitive', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['secret project'] };
    const result = layer.process('This involves Secret Project details', ctx);
    expect(result.blocked).toBe(true);
  });

  it('blocks on regex match', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['/internal-\\d{4}/i'] };
    const result = layer.process('Reference internal-1234 is classified', ctx);
    expect(result.blocked).toBe(true);
  });

  it('regex uses flags correctly', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['/CLASSIFIED/i'] };
    const result = layer.process('this is classified info', ctx);
    expect(result.blocked).toBe(true);
  });

  it('does not block when no patterns match', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['Project X', '/secret-\\d+/'] };
    const result = layer.process('This is a normal lesson about error handling', ctx);
    expect(result.blocked).toBe(false);
    expect(result.output).toBe('This is a normal lesson about error handling');
  });

  it('does not modify text when not blocking', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['Project X'] };
    const result = layer.process('Normal content here', ctx);
    expect(result.output).toBe('Normal content here');
  });

  it('preserves original text even when blocking', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['secret'] };
    const result = layer.process('This is secret info', ctx);
    expect(result.output).toBe('This is secret info');
    expect(result.blocked).toBe(true);
  });

  it('checks all patterns (blocks on first match)', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['harmless', 'dangerous'] };
    const result = layer.process('This is dangerous', ctx);
    expect(result.blocked).toBe(true);
  });

  it('handles empty deny list', () => {
    const ctx = { ...baseCtx, denyListPatterns: [] };
    const result = layer.process('Any content', ctx);
    expect(result.blocked).toBe(false);
  });

  it('handles invalid regex gracefully', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['/[invalid/'] };
    const result = layer.process('Some content', ctx);
    expect(result.blocked).toBe(false); // invalid regex is skipped
  });

  it('produces findings when blocking', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['classified'] };
    const result = layer.process('This is classified', ctx);
    expect(result.findings).toHaveLength(1);
    const f = result.findings[0];
    expect(f.layer).toBe('semantic_denylist');
    expect(f.category).toBe('denied_content');
    expect(f.confidence).toBe(1.0);
  });

  it('produces no findings when not blocking', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['classified'] };
    const result = layer.process('Normal content', ctx);
    expect(result.findings).toHaveLength(0);
  });

  it('blocks entire lesson (not redact-and-continue)', () => {
    const ctx = { ...baseCtx, denyListPatterns: ['secret'] };
    const result = layer.process('Has secret word but also normal content', ctx);
    expect(result.blocked).toBe(true);
    // Output is untouched (blocked entirely, not redacted)
    expect(result.output).toContain('secret');
  });
});

// ═══════════════════════════════════════════════════════════
// Layer 6: HumanReviewLayer
// ═══════════════════════════════════════════════════════════

describe('HumanReviewLayer', () => {
  it('has correct name and order', () => {
    const layer = new HumanReviewLayer();
    expect(layer.name).toBe('human_review');
    expect(layer.order).toBe(600);
  });

  it('passes through when disabled', async () => {
    const layer = new HumanReviewLayer(false);
    const result = await layer.process('Some content', baseCtx);
    expect(result.blocked).toBe(false);
    expect(result.output).toBe('Some content');
    expect(result.findings).toHaveLength(0);
  });

  it('blocks and queues when enabled with store', async () => {
    const mockStore: ReviewQueueStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn().mockReturnValue(null),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const fixedId = 'review-123';
    const layer = new HumanReviewLayer(true, mockStore, () => fixedId);
    const result = await layer.process('Content to review', baseCtx);

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('pending_review:review-123');
    expect(mockStore.addToQueue).toHaveBeenCalledTimes(1);
    expect((mockStore.addToQueue as any).mock.calls[0][0].id).toBe('review-123');
    expect((mockStore.addToQueue as any).mock.calls[0][0].status).toBe('pending');
  });

  it('blocks when enabled but no store (fail-closed)', async () => {
    const layer = new HumanReviewLayer(true);
    const result = await layer.process('Content', baseCtx);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain('no review queue store');
  });

  it('sets expiration to 7 days', async () => {
    const mockStore: ReviewQueueStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn().mockReturnValue(null),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const layer = new HumanReviewLayer(true, mockStore);
    await layer.process('Content', baseCtx);

    const entry = (mockStore.addToQueue as any).mock.calls[0][0];
    const created = new Date(entry.createdAt).getTime();
    const expires = new Date(entry.expiresAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expires - created).toBe(sevenDays);
  });

  it('produces finding when queuing', async () => {
    const mockStore: ReviewQueueStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn().mockReturnValue(null),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const layer = new HumanReviewLayer(true, mockStore);
    const result = await layer.process('Content', baseCtx);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].layer).toBe('human_review');
    expect(result.findings[0].category).toBe('pending_review');
  });

  it('uses custom ID generator', async () => {
    const mockStore: ReviewQueueStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn().mockReturnValue(null),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const layer = new HumanReviewLayer(true, mockStore, () => 'custom-id-999');
    const result = await layer.process('Content', baseCtx);
    expect(result.blockReason).toContain('custom-id-999');
  });

  it('passes tenantId to store', async () => {
    const mockStore: ReviewQueueStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn().mockReturnValue(null),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const ctx = { ...baseCtx, tenantId: 'my-tenant' };
    const layer = new HumanReviewLayer(true, mockStore);
    await layer.process('Content', ctx);
    expect((mockStore.addToQueue as any).mock.calls[0][0].tenantId).toBe('my-tenant');
  });
});
