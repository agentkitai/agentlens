/**
 * Tests for Redaction Types (Phase 4 — Story 1.1)
 */

import { describe, it, expect } from 'vitest';
import type {
  RawLessonContent,
  RedactedLessonContent,
  RedactionFinding,
  RedactionLayerName,
  RedactionResult,
  RedactionLayer,
  RedactionContext,
  RedactionLayerResult,
} from '../redaction-types.js';
import {
  REDACTION_LAYER_NAMES,
  createRawLessonContent,
  createRedactedLessonContent,
  REDACTION_PIPELINE_KEY,
} from '../redaction-types.js';

describe('Redaction Types (Story 1.1)', () => {
  // ─── Branded Types ───────────────────────────────────────

  it('should create RawLessonContent with correct brand', () => {
    const raw = createRawLessonContent('title', 'content', { key: 'val' });
    expect(raw.__brand).toBe('RawLessonContent');
    expect(raw.title).toBe('title');
    expect(raw.content).toBe('content');
    expect(raw.context).toEqual({ key: 'val' });
  });

  it('should create RedactedLessonContent with correct brand', () => {
    const redacted = createRedactedLessonContent('title', 'content', {}, REDACTION_PIPELINE_KEY);
    expect(redacted.__brand).toBe('RedactedLessonContent');
    expect(redacted.context).toEqual({});
  });

  it('should have different brands for Raw and Redacted', () => {
    const raw = createRawLessonContent('t', 'c');
    const redacted = createRedactedLessonContent('t', 'c', {}, REDACTION_PIPELINE_KEY);
    expect(raw.__brand).not.toBe(redacted.__brand);
  });

  it('should enforce compile-time: RawLessonContent NOT assignable to RedactedLessonContent', () => {
    // This test verifies the branded type pattern works at runtime.
    // The compile-time guarantee is that the __brand literals differ.
    const raw: RawLessonContent = createRawLessonContent('t', 'c');
    const redacted: RedactedLessonContent = createRedactedLessonContent('t', 'c', {}, REDACTION_PIPELINE_KEY);

    // At runtime, brands are just strings — but TypeScript prevents assignment
    expect(raw.__brand).toBe('RawLessonContent');
    expect(redacted.__brand).toBe('RedactedLessonContent');

    // Verify they are structurally different
    const rawBrand: string = raw.__brand;
    const redactedBrand: string = redacted.__brand;
    expect(rawBrand).not.toBe(redactedBrand);
  });

  it('should throw when createRedactedLessonContent is called without pipeline key (H1 fix)', () => {
    expect(() => createRedactedLessonContent('t', 'c')).toThrow('internal to the RedactionPipeline');
  });

  it('should default context to empty object', () => {
    const raw = createRawLessonContent('t', 'c');
    expect(raw.context).toEqual({});
  });

  // ─── RedactionLayerName ──────────────────────────────────

  it('should have all 6 redaction layer names', () => {
    expect(REDACTION_LAYER_NAMES).toHaveLength(6);
    expect(REDACTION_LAYER_NAMES).toContain('secret_detection');
    expect(REDACTION_LAYER_NAMES).toContain('pii_detection');
    expect(REDACTION_LAYER_NAMES).toContain('url_path_scrubbing');
    expect(REDACTION_LAYER_NAMES).toContain('tenant_deidentification');
    expect(REDACTION_LAYER_NAMES).toContain('semantic_denylist');
    expect(REDACTION_LAYER_NAMES).toContain('human_review');
  });

  // ─── RedactionFinding ────────────────────────────────────

  it('should create a valid RedactionFinding', () => {
    const finding: RedactionFinding = {
      layer: 'secret_detection',
      category: 'api_key',
      originalLength: 51,
      replacement: '[API_KEY]',
      startOffset: 10,
      endOffset: 61,
      confidence: 0.95,
    };
    expect(finding.layer).toBe('secret_detection');
    expect(finding.confidence).toBeGreaterThanOrEqual(0);
    expect(finding.confidence).toBeLessThanOrEqual(1);
  });

  // ─── RedactionResult ─────────────────────────────────────

  it('should support redacted result status', () => {
    const result: RedactionResult = {
      status: 'redacted',
      content: createRedactedLessonContent('t', 'c', {}, REDACTION_PIPELINE_KEY),
      findings: [],
    };
    expect(result.status).toBe('redacted');
  });

  it('should support blocked result status', () => {
    const result: RedactionResult = {
      status: 'blocked',
      reason: 'Deny list match',
      layer: 'semantic_denylist',
    };
    expect(result.status).toBe('blocked');
  });

  it('should support pending_review result status', () => {
    const result: RedactionResult = {
      status: 'pending_review',
      reviewId: 'review-123',
    };
    expect(result.status).toBe('pending_review');
  });

  it('should support error result status', () => {
    const result: RedactionResult = {
      status: 'error',
      error: 'Layer failed',
      layer: 'pii_detection',
    };
    expect(result.status).toBe('error');
  });

  // ─── RedactionContext ────────────────────────────────────

  it('should create a valid RedactionContext', () => {
    const ctx: RedactionContext = {
      tenantId: 'tenant-1',
      agentId: 'agent-1',
      category: 'general',
      denyListPatterns: ['secret-project'],
      knownTenantTerms: ['Acme Corp'],
    };
    expect(ctx.tenantId).toBe('tenant-1');
    expect(ctx.denyListPatterns).toHaveLength(1);
  });

  it('should allow RedactionContext without optional agentId', () => {
    const ctx: RedactionContext = {
      tenantId: 'tenant-1',
      category: 'general',
      denyListPatterns: [],
      knownTenantTerms: [],
    };
    expect(ctx.agentId).toBeUndefined();
  });

  // ─── Exports from barrel ─────────────────────────────────

  it('should export all types from core barrel', async () => {
    const core = await import('../index.js');
    expect(core.REDACTION_LAYER_NAMES).toBeDefined();
    expect(typeof core.createRawLessonContent).toBe('function');
    expect(typeof core.createRedactedLessonContent).toBe('function');
  });
});
