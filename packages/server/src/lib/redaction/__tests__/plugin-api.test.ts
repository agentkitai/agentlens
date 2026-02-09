/**
 * Tests for Redaction Plugin API (Story 2.5)
 * ~15 tests covering custom RedactionLayer registration, ordering, error handling.
 */

import { describe, it, expect } from 'vitest';
import { RedactionPipeline } from '../pipeline.js';
import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
} from '@agentlensai/core';
import { createRawLessonContent } from '@agentlensai/core';

const ctx: RedactionContext = {
  tenantId: 'test-tenant',
  category: 'general',
  denyListPatterns: [],
  knownTenantTerms: [],
};

function makeRaw(title: string, content: string) {
  return createRawLessonContent(title, content, {});
}

function makeCustomLayer(
  name: string,
  order: number,
  processFn?: (input: string, context: RedactionContext) => RedactionLayerResult,
): RedactionLayer {
  return {
    name,
    order,
    process: processFn ?? ((input) => ({
      output: input,
      findings: [],
      blocked: false,
    })),
  };
}

describe('Redaction Plugin API — Story 2.5', () => {
  describe('registerCustomLayer()', () => {
    it('adds a custom layer to the pipeline', () => {
      const pipeline = new RedactionPipeline();
      const initialCount = pipeline.getLayers().length;
      pipeline.registerCustomLayer(makeCustomLayer('custom-1', 50));
      expect(pipeline.getLayers().length).toBe(initialCount + 1);
    });

    it('inserts custom layer at correct position by order', () => {
      const pipeline = new RedactionPipeline();
      // Default layers have orders 100, 200, 300, 400, 500, 600
      pipeline.registerCustomLayer(makeCustomLayer('custom-early', 50));
      const layers = pipeline.getLayers();
      expect(layers[0].name).toBe('custom-early');
    });

    it('inserts custom layer between existing layers', () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer(makeCustomLayer('custom-mid', 250));
      const layers = pipeline.getLayers();
      const names = layers.map((l) => l.name);
      const idx = names.indexOf('custom-mid');
      expect(idx).toBeGreaterThan(0);
      expect(idx).toBeLessThan(layers.length - 1);
      // Should be after layers with order < 250 and before layers with order > 250
      expect(layers[idx - 1].order).toBeLessThanOrEqual(250);
      expect(layers[idx + 1].order).toBeGreaterThanOrEqual(250);
    });

    it('supports multiple custom layers', () => {
      const pipeline = new RedactionPipeline();
      const initialCount = pipeline.getLayers().length;
      pipeline.registerCustomLayer(makeCustomLayer('custom-a', 150));
      pipeline.registerCustomLayer(makeCustomLayer('custom-b', 350));
      pipeline.registerCustomLayer(makeCustomLayer('custom-c', 550));
      expect(pipeline.getLayers().length).toBe(initialCount + 3);
    });

    it('maintains correct ordering with multiple custom layers', () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer(makeCustomLayer('custom-late', 100));
      pipeline.registerCustomLayer(makeCustomLayer('custom-early', 1));
      const layers = pipeline.getLayers();
      const orders = layers.map((l) => l.order);
      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1]);
      }
    });
  });

  describe('custom layer execution', () => {
    it('custom layer receives content and context', async () => {
      let receivedInput = '';
      let receivedCtx: RedactionContext | null = null;

      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'spy-layer',
        order: 25,
        process(input, context) {
          receivedInput = input;
          receivedCtx = context;
          return { output: input, findings: [], blocked: false };
        },
      });

      await pipeline.process(makeRaw('Title', 'Content'), ctx);
      expect(receivedInput).toContain('Title');
      expect(receivedInput).toContain('Content');
      expect(receivedCtx).toBeTruthy();
      expect(receivedCtx!.tenantId).toBe('test-tenant');
    });

    it('custom layer can modify content', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'replace-layer',
        order: 25,
        process(input) {
          return {
            output: input.replace(/SECRET_WORD/g, '[CUSTOM_REDACTED]'),
            findings: [{
              layer: 'replace-layer' as any,
              category: 'custom',
              originalLength: 11,
              replacement: '[CUSTOM_REDACTED]',
              startOffset: 0,
              endOffset: 11,
              confidence: 1.0,
            }],
            blocked: false,
          };
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Contains SECRET_WORD here'), ctx);
      expect(result.status).toBe('redacted');
      if (result.status === 'redacted') {
        expect(result.content.content).toContain('[CUSTOM_REDACTED]');
        expect(result.findings.some((f) => f.category === 'custom')).toBe(true);
      }
    });

    it('custom layer findings are aggregated with other layers', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'finding-layer',
        order: 25,
        process(input) {
          return {
            output: input,
            findings: [{
              layer: 'finding-layer' as any,
              category: 'custom-finding',
              originalLength: 5,
              replacement: '[X]',
              startOffset: 0,
              endOffset: 5,
              confidence: 0.9,
            }],
            blocked: false,
          };
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Content'), ctx);
      expect(result.status).toBe('redacted');
      if (result.status === 'redacted') {
        expect(result.findings.some((f) => f.category === 'custom-finding')).toBe(true);
      }
    });

    it('custom layer can block content', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'blocker-layer',
        order: 25,
        process() {
          return {
            output: '',
            findings: [],
            blocked: true,
            blockReason: 'Custom policy violation',
          };
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Content'), ctx);
      expect(result.status).toBe('blocked');
      if (result.status === 'blocked') {
        expect(result.reason).toBe('Custom policy violation');
      }
    });
  });

  describe('fail-closed on plugin errors', () => {
    it('pipeline returns error when custom layer throws', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'error-layer',
        order: 25,
        process() {
          throw new Error('Plugin crashed');
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Content'), ctx);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Plugin crashed');
        expect(result.layer).toBe('error-layer');
      }
    });

    it('pipeline returns error when async custom layer rejects', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'async-error-layer',
        order: 25,
        async process() {
          throw new Error('Async plugin failure');
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Content'), ctx);
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error).toContain('Async plugin failure');
      }
    });

    it('content is NOT shared when plugin errors (fail-closed)', async () => {
      const pipeline = new RedactionPipeline();
      pipeline.registerCustomLayer({
        name: 'crash-layer',
        order: 5, // runs first
        process() {
          throw new Error('Crash');
        },
      });

      const result = await pipeline.process(makeRaw('Title', 'Sensitive content'), ctx);
      expect(result.status).toBe('error');
      // No redacted content should be returned
      expect('content' in result).toBe(false);
    });
  });

  describe('constructor custom layers', () => {
    it('supports custom layers via constructor', () => {
      const pipeline = new RedactionPipeline({}, [
        makeCustomLayer('ctor-layer', 25),
      ]);
      const names = pipeline.getLayers().map((l) => l.name);
      expect(names).toContain('ctor-layer');
    });

    it('constructor and registerCustomLayer work together', () => {
      const pipeline = new RedactionPipeline({}, [
        makeCustomLayer('ctor-layer', 25),
      ]);
      pipeline.registerCustomLayer(makeCustomLayer('runtime-layer', 35));
      const names = pipeline.getLayers().map((l) => l.name);
      expect(names).toContain('ctor-layer');
      expect(names).toContain('runtime-layer');
    });
  });
});
