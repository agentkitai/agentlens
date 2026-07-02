import { describe, it, expect } from 'vitest';
import { RegexScanner } from '../regex-scanner.js';

const ctx = { tenantId: 'default', agentId: 'a', toolName: 'unknown', direction: 'output' as const };

describe('RegexScanner (content_regex)', () => {
  it('matches content against the configured pattern', () => {
    const s = new RegexScanner();
    s.compile({ pattern: 'secret' });
    const { matches } = s.scan('my secret is 12345 and another secret', ctx);
    expect(matches.length).toBe(2);
    expect(matches[0]!.conditionType).toBe('content_regex');
    expect(matches[0]!.offset).toEqual({ start: 3, end: 9 });
  });

  it('returns no matches when the pattern is absent from the content', () => {
    const s = new RegexScanner();
    s.compile({ pattern: 'password' });
    expect(s.scan('nothing sensitive here', ctx).matches).toEqual([]);
  });

  it('degrades gracefully on an invalid regex (no throw, no matches)', () => {
    const s = new RegexScanner();
    s.compile({ pattern: '([unclosed' });
    expect(s.scan('anything', ctx).matches).toEqual([]);
  });

  it('does not loop forever on a zero-width match', () => {
    const s = new RegexScanner();
    s.compile({ pattern: 'x*' });
    // Should terminate and return a bounded number of matches.
    const { matches } = s.scan('abc', ctx);
    expect(matches.length).toBeLessThan(1000);
  });
});
