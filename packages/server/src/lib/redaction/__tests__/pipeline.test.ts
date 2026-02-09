/**
 * Tests for Redaction Pipeline Orchestrator (Story 2.3)
 */

import { describe, it, expect, vi } from 'vitest';
import { RedactionPipeline } from '../pipeline.js';
import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RawLessonContent,
  RedactedLessonContent,
} from '@agentlensai/core';
import { createRawLessonContent } from '@agentlensai/core';

const ctx: RedactionContext = {
  tenantId: 'test-tenant',
  category: 'general',
  denyListPatterns: [],
  knownTenantTerms: [],
};

function makeRaw(title: string, content: string, context: Record<string, unknown> = {}): RawLessonContent {
  return createRawLessonContent(title, content, context);
}

// ═══════════════════════════════════════════════════════════
// Pipeline Orchestration
// ═══════════════════════════════════════════════════════════

describe('RedactionPipeline', () => {
  it('creates pipeline with all 6 default layers', () => {
    const pipeline = new RedactionPipeline();
    expect(pipeline.getLayers()).toHaveLength(6);
  });

  it('layers are sorted by order', () => {
    const pipeline = new RedactionPipeline();
    const orders = pipeline.getLayers().map(l => l.order);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
    }
  });

  it('processes clean content successfully', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Error Handling', 'Use try-catch for async operations.');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('redacted');
    if (result.status === 'redacted') {
      expect(result.content.__brand).toBe('RedactedLessonContent');
      expect(result.content.title).toBe('Error Handling');
      expect(result.content.content).toBe('Use try-catch for async operations.');
    }
  });

  it('produces RedactedLessonContent branded type', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Title', 'Content');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.__brand).toBe('RedactedLessonContent');
      // Verify it's not RawLessonContent
      expect(result.content.__brand).not.toBe('RawLessonContent');
    }
  });

  it('always strips context field', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Title', 'Content', { secret: 'data', tenantInfo: 'private' });
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.context).toEqual({});
    }
  });

  it('redacts secrets from content', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('API Usage', 'Use key sk-abc123def456ghi789jklmnopqrstuvwxyz');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('redacted');
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[SECRET_REDACTED_');
      expect(result.content.content).not.toContain('sk-abc123');
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  it('redacts PII from content', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Contact Info', 'Email john@example.com for help');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('redacted');
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[EMAIL]');
    }
  });

  it('redacts internal URLs', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Setup', 'Connect to http://localhost:3000/api');
    const result = await pipeline.process(raw, ctx);
    expect(result.status === 'redacted').toBe(true);
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[INTERNAL_URL]');
    }
  });

  it('redacts file paths', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Config', 'Edit /home/user/.bashrc');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[FILE_PATH]');
    }
  });

  it('strips tenant terms', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Pattern', 'MegaCorp uses this approach');
    const ctxWithTerms = { ...ctx, knownTenantTerms: ['MegaCorp'] };
    const result = await pipeline.process(raw, ctxWithTerms);
    if (result.status === 'redacted') {
      expect(result.content.content).not.toContain('MegaCorp');
    }
  });

  it('aggregates findings from all layers', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Mixed', 'sk-abc123def456ghi789jklmnopqrstuvwxyz and john@example.com and /home/user/file');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      const layers = new Set(result.findings.map(f => f.layer));
      expect(layers.size).toBeGreaterThanOrEqual(2);
    }
  });

  // ─── Fail-closed behavior ──────────────────────────
  it('blocks on any layer error (fail-closed)', async () => {
    const errorLayer: RedactionLayer = {
      name: 'test_error',
      order: 150,
      process: () => { throw new Error('Layer crashed'); },
    };
    const pipeline = new RedactionPipeline({}, [errorLayer]);
    const raw = makeRaw('Title', 'Content');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('Layer crashed');
      expect(result.layer).toBe('test_error');
    }
  });

  it('returns error with layer name on failure', async () => {
    const errorLayer: RedactionLayer = {
      name: 'bad_layer',
      order: 250,
      process: () => { throw new TypeError('Oops'); },
    };
    const pipeline = new RedactionPipeline({}, [errorLayer]);
    const raw = makeRaw('Title', 'Content');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.layer).toBe('bad_layer');
    }
  });

  // ─── Deny list blocking ────────────────────────────
  it('blocks when deny list matches', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Pattern', 'This involves Project X classified info');
    const ctxWithDeny = { ...ctx, denyListPatterns: ['Project X'] };
    const result = await pipeline.process(raw, ctxWithDeny);
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toContain('Project X');
      expect(result.layer).toBe('semantic_denylist');
    }
  });

  // ─── Human review ──────────────────────────────────
  it('returns pending_review when human review enabled', async () => {
    const mockStore = {
      addToQueue: vi.fn(),
      getReviewStatus: vi.fn(),
      approveReview: vi.fn(),
      rejectReview: vi.fn(),
    };
    const pipeline = new RedactionPipeline({
      humanReviewEnabled: true,
      reviewQueueStore: mockStore,
    });
    const raw = makeRaw('Title', 'Content');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('pending_review');
    if (result.status === 'pending_review') {
      expect(result.reviewId).toBeTruthy();
    }
  });

  it('passes through when human review disabled (default)', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Title', 'Clean content');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('redacted');
  });

  // ─── Custom layer injection ────────────────────────
  it('supports custom layer injection', async () => {
    const customLayer: RedactionLayer = {
      name: 'custom_test',
      order: 350,
      process: (input: string): RedactionLayerResult => ({
        output: input.replace(/CUSTOM_WORD/g, '[CUSTOM]'),
        findings: [],
        blocked: false,
      }),
    };
    const pipeline = new RedactionPipeline({}, [customLayer]);
    const raw = makeRaw('Title', 'Contains CUSTOM_WORD here');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[CUSTOM]');
    }
  });

  it('custom layers are sorted by order', async () => {
    const layer1: RedactionLayer = {
      name: 'custom_1',
      order: 350,
      process: (input) => ({ output: input + ' [L1]', findings: [], blocked: false }),
    };
    const layer2: RedactionLayer = {
      name: 'custom_2',
      order: 150,
      process: (input) => ({ output: input + ' [L2]', findings: [], blocked: false }),
    };
    const pipeline = new RedactionPipeline({}, [layer1, layer2]);
    const layers = pipeline.getLayers();
    const customOrders = layers.filter(l => l.name.startsWith('custom_')).map(l => l.order);
    expect(customOrders[0]).toBeLessThan(customOrders[1]);
  });

  it('multiple custom layers work together', async () => {
    const layer1: RedactionLayer = {
      name: 'custom_a',
      order: 150,
      process: (input) => ({
        output: input.replace(/AAA/g, '[A]'),
        findings: [],
        blocked: false,
      }),
    };
    const layer2: RedactionLayer = {
      name: 'custom_b',
      order: 350,
      process: (input) => ({
        output: input.replace(/BBB/g, '[B]'),
        findings: [],
        blocked: false,
      }),
    };
    const pipeline = new RedactionPipeline({}, [layer1, layer2]);
    const raw = makeRaw('Title', 'AAA and BBB');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.content).toContain('[A]');
      expect(result.content.content).toContain('[B]');
    }
  });

  // ─── Title and content separation ──────────────────
  it('correctly splits title and content back', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('My Title', 'My Content');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.title).toBe('My Title');
      expect(result.content.content).toBe('My Content');
    }
  });

  it('handles content with separator characters', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Title', 'Content with\n---\nmore sections');
    const result = await pipeline.process(raw, ctx);
    if (result.status === 'redacted') {
      expect(result.content.title).toBe('Title');
      expect(result.content.content).toContain('more sections');
    }
  });

  it('handles empty content', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw('Title Only', '');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('redacted');
  });

  // ─── Non-string error handling ─────────────────────
  it('handles non-Error throws (fail-closed)', async () => {
    const errorLayer: RedactionLayer = {
      name: 'string_thrower',
      order: 150,
      process: () => { throw 'string error'; },
    };
    const pipeline = new RedactionPipeline({}, [errorLayer]);
    const raw = makeRaw('Title', 'Content');
    const result = await pipeline.process(raw, ctx);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('string error');
    }
  });

  // ─── Pipeline with all features ────────────────────
  it('end-to-end: redacts secrets, PII, paths, and tenant terms', async () => {
    const pipeline = new RedactionPipeline();
    const raw = makeRaw(
      'Production Setup',
      'Use sk-abc123def456ghi789jklmnopqrstuvwxyz to connect. ' +
      'Contact admin@megacorp.com at /home/deploy/config.yml. ' +
      'Server: http://localhost:8080/api',
    );
    const ctxFull: RedactionContext = {
      tenantId: 'megacorp',
      category: 'general',
      denyListPatterns: [],
      knownTenantTerms: ['megacorp'],
    };
    const result = await pipeline.process(raw, ctxFull);
    expect(result.status).toBe('redacted');
    if (result.status === 'redacted') {
      expect(result.content.content).not.toContain('sk-abc123');
      expect(result.content.content).not.toContain('admin@megacorp.com');
      expect(result.content.content).not.toContain('/home/deploy');
      expect(result.content.content).not.toContain('localhost');
      expect(result.content.context).toEqual({});
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });
});
