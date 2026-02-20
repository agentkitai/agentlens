/**
 * Tests for sanitizeForLLM (Story 18.2)
 */
import { describe, it, expect } from 'vitest';
import { sanitizeForLLM, sanitizeErrorMessage } from '../error-sanitizer.js';

describe('sanitizeForLLM', () => {
  it('replaces file paths with <PATH>', () => {
    expect(sanitizeForLLM('Error in /home/user/project/file.ts')).toContain('<PATH>');
    expect(sanitizeForLLM('C:\\Users\\admin\\file.js')).toContain('<PATH>');
  });

  it('replaces UUIDs with <ID>', () => {
    expect(sanitizeForLLM('Session 550e8400-e29b-41d4-a716-446655440000 failed'))
      .toBe('Session <ID> failed');
  });

  it('replaces API key patterns with <SECRET>', () => {
    expect(sanitizeForLLM('key: sk-abc123def456ghi789jkl012mno')).toContain('<SECRET>');
    expect(sanitizeForLLM('token: ghp_abcdefghijklmnopqrstuvwxyz1234567890')).toContain('<SECRET>');
    expect(sanitizeForLLM('xoxb-123-456-abc')).toContain('<SECRET>');
  });

  it('strips stack trace frames', () => {
    const input = `Error: something\n    at Module._compile (node:internal/modules/cjs/loader:1234:14)\n    at Object.Module._extensions..js (node:internal/modules/cjs/loader:1456:10)`;
    const result = sanitizeForLLM(input);
    expect(result).not.toContain('Module._compile');
    expect(result).toContain('<STACK_FRAME>');
  });

  it('preserves agent IDs and tool names', () => {
    const input = 'Agent my-coding-agent called tool write_file with cost $0.05';
    expect(sanitizeForLLM(input)).toBe(input);
  });

  it('preserves cost data', () => {
    const input = 'Total cost: $1.234 across 5 sessions';
    expect(sanitizeForLLM(input)).toBe(input);
  });

  it('handles empty string', () => {
    expect(sanitizeForLLM('')).toBe('');
  });
});

describe('sanitizeErrorMessage (regression)', () => {
  it('still returns generic message for non-ClientError', () => {
    expect(sanitizeErrorMessage(new Error('Internal details'))).toBe('Internal server error');
  });
});
