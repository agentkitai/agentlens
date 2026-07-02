import { describe, it, expect } from 'vitest';
import { ToxicityScanner } from '../toxicity-scanner.js';

const ctx = { tenantId: 'default', agentId: 'a', toolName: 'unknown', direction: 'output' as const };

describe('ToxicityScanner', () => {
  it('flags profane content with the toxic token + a valid offset', () => {
    const s = new ToxicityScanner();
    s.compile({}); // defaults: local_wordlist, threshold 0.7, all categories
    const { matches } = s.scan('this is fucking broken', ctx);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.conditionType).toBe('toxicity_detection');
    expect(matches[0]!.redactionToken).toBe('[TOXIC_REDACTED]');
    expect(matches[0]!.offset.end).toBeGreaterThan(matches[0]!.offset.start);
  });

  it('catches obfuscated (leetspeak) profanity', () => {
    const s = new ToxicityScanner();
    s.compile({});
    expect(s.scan('what an assh0le move', ctx).matches.length).toBeGreaterThan(0);
  });

  it('passes clean content', () => {
    const s = new ToxicityScanner();
    s.compile({});
    expect(s.scan('the deployment finished successfully', ctx).matches).toEqual([]);
  });

  it('is disabled when no categories are selected', () => {
    const s = new ToxicityScanner();
    s.compile({ categories: [] });
    expect(s.scan('this is fucking broken', ctx).matches).toEqual([]);
  });

  it('a threshold above the match confidence gates everything out', () => {
    const s = new ToxicityScanner();
    s.compile({ threshold: 0.95 });
    expect(s.scan('this is fucking broken', ctx).matches).toEqual([]);
  });
});
