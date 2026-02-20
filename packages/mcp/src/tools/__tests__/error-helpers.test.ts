/**
 * Tests for error-helpers (Feature 10, Story 10.5)
 */

import { describe, it, expect } from 'vitest';
import { formatApiError } from '../error-helpers.js';

describe('formatApiError', () => {
  it('returns upgrade suggestion for 404 errors', () => {
    const result = formatApiError(new Error('404: Not Found'), 'sessions');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('404');
    expect(result.content[0].text).toContain('newer AgentLens server version');
    expect(result.content[0].text).toContain('"sessions"');
  });

  it('returns upgrade suggestion for 501 errors', () => {
    const result = formatApiError(new Error('501: Not Implemented'), 'analytics');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });

  it('does not include upgrade suggestion for 500 errors', () => {
    const result = formatApiError(new Error('500: Internal Server Error'), 'sessions');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('500');
    expect(result.content[0].text).not.toContain('newer AgentLens server version');
  });

  it('handles non-Error input', () => {
    const result = formatApiError('something went wrong', 'alerts');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('something went wrong');
  });

  it('returns standard MCP tool result shape', () => {
    const result = formatApiError(new Error('test'), 'test');
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(typeof result.content[0].text).toBe('string');
    expect(result.isError).toBe(true);
  });
});
