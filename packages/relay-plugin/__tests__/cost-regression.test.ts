import { describe, it, expect } from 'vitest';
import { estimateCost, extractUsageFromMessages } from '../service.js';

describe('Cost Estimation', () => {
  describe('estimateCost', () => {
    it('calculates cost correctly for claude-opus-4-6', () => {
      // 1000 input (uncached), 500 output, no cache
      const cost = estimateCost('claude-opus-4-6', 1000, 500, 0, 0);
      // (1000 * 15 + 500 * 75) / 1_000_000 = (15000 + 37500) / 1_000_000 = 0.0525
      expect(cost).toBeCloseTo(0.0525, 6);
    });

    it('calculates cost correctly for claude-sonnet-4', () => {
      const cost = estimateCost('claude-sonnet-4', 1000, 500, 0, 0);
      // (1000 * 3 + 500 * 15) / 1_000_000 = 10500 / 1_000_000 = 0.0105
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('handles cache read tokens correctly — reduces uncached input', () => {
      // 1000 input total, 400 cache read, 0 cache write
      // uncachedInput = max(0, 1000 - 400 - 0) = 600
      const cost = estimateCost('claude-opus-4-6', 1000, 500, 400, 0);
      // (600 * 15 + 500 * 75 + 400 * 1.5 + 0) / 1_000_000
      // = (9000 + 37500 + 600) / 1_000_000 = 0.047100
      expect(cost).toBeCloseTo(0.0471, 6);
    });

    it('handles cache write tokens correctly', () => {
      const cost = estimateCost('claude-opus-4-6', 1000, 500, 0, 200);
      // uncachedInput = max(0, 1000 - 0 - 200) = 800
      // (800 * 15 + 500 * 75 + 0 + 200 * 18.75) / 1_000_000
      // = (12000 + 37500 + 3750) / 1_000_000 = 0.05325
      expect(cost).toBeCloseTo(0.05325, 6);
    });

    it('returns 0 for unknown model', () => {
      const cost = estimateCost('gpt-4o', 1000, 500, 0, 0);
      expect(cost).toBe(0);
    });

    it('does not go negative when cache exceeds input tokens', () => {
      // cache read + cache write > input tokens — uncached should floor at 0
      const cost = estimateCost('claude-opus-4-6', 100, 500, 200, 100);
      // uncachedInput = max(0, 100 - 200 - 100) = 0
      // (0 + 500*75 + 200*1.5 + 100*18.75) / 1_000_000
      // = (37500 + 300 + 1875) / 1_000_000 = 0.039675
      expect(cost).toBeCloseTo(0.039675, 6);
      expect(cost).toBeGreaterThan(0);
    });

    it('cost values are not zeroed or doubled through passthrough', () => {
      // Regression: cost should be computed once and correctly
      const cost1 = estimateCost('claude-sonnet-4', 5000, 2000, 1000, 500);
      const cost2 = estimateCost('claude-sonnet-4', 5000, 2000, 1000, 500);
      expect(cost1).toBe(cost2);
      expect(cost1).toBeGreaterThan(0);
      // Verify exact value
      // uncached = max(0, 5000 - 1000 - 500) = 3500
      // (3500*3 + 2000*15 + 1000*0.3 + 500*3.75) / 1_000_000
      // = (10500 + 30000 + 300 + 1875) / 1_000_000 = 0.042675
      expect(cost1).toBeCloseTo(0.042675, 6);
    });
  });

  describe('extractUsageFromMessages', () => {
    it('extracts usage from last assistant message', () => {
      const messages = [
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: 'hi',
          model: 'claude-sonnet-4',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
          },
        },
      ];
      const result = extractUsageFromMessages(messages);
      expect(result.model).toBe('claude-sonnet-4');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheRead).toBe(10);
      expect(result.cacheWrite).toBe(5);
    });

    it('uses only the LAST assistant message (not sum)', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'first',
          model: 'claude-sonnet-4',
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
        { role: 'user', content: 'more' },
        {
          role: 'assistant',
          content: 'second',
          model: 'claude-sonnet-4',
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      ];
      const result = extractUsageFromMessages(messages);
      // Should use LAST assistant, not sum
      expect(result.inputTokens).toBe(200);
      expect(result.outputTokens).toBe(100);
    });

    it('returns zeros for non-array input', () => {
      const result = extractUsageFromMessages(null as any);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.model).toBe('');
    });

    it('returns zeros when no assistant messages exist', () => {
      const messages = [{ role: 'user', content: 'hello' }];
      const result = extractUsageFromMessages(messages);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('handles alternative field names (inputTokens instead of input_tokens)', () => {
      const messages = [
        {
          role: 'assistant',
          content: 'hi',
          model: 'test-model',
          usage: { inputTokens: 300, outputTokens: 150, cacheRead: 20, cacheWrite: 10 },
        },
      ];
      const result = extractUsageFromMessages(messages);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.cacheRead).toBe(20);
      expect(result.cacheWrite).toBe(10);
    });
  });
});
