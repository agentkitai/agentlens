/**
 * Tests for Response Parser (Story 18.5)
 */
import { describe, it, expect } from 'vitest';
import { parseLLMResponse } from '../response-parser.js';

describe('parseLLMResponse', () => {
  it('parses valid diagnostic JSON', () => {
    const valid = JSON.stringify({
      severity: 'warning',
      summary: 'Agent has elevated error rates',
      rootCauses: [
        {
          description: 'File permission errors',
          confidence: 0.85,
          category: 'error_pattern',
          evidence: [{ type: 'error_pattern', summary: 'EACCES occurred 23 times' }],
        },
      ],
      recommendations: [
        { action: 'Fix permissions', priority: 'high', rationale: 'Most common error' },
      ],
    });

    const result = parseLLMResponse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.severity).toBe('warning');
      expect(result.data.rootCauses).toHaveLength(1);
      expect(result.data.rootCauses[0]!.confidence).toBe(0.85);
    }
  });

  it('rejects invalid JSON', () => {
    const result = parseLLMResponse('not json at all');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Invalid JSON');
    }
  });

  it('rejects invalid schema (missing severity)', () => {
    const result = parseLLMResponse(JSON.stringify({
      summary: 'Test',
      rootCauses: [],
      recommendations: [],
    }));
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of range', () => {
    const result = parseLLMResponse(JSON.stringify({
      severity: 'info',
      summary: 'Test',
      rootCauses: [{
        description: 'Test',
        confidence: 1.5,
        category: 'error_pattern',
        evidence: [],
      }],
      recommendations: [],
    }));
    expect(result.success).toBe(false);
  });

  it('accepts empty arrays', () => {
    const result = parseLLMResponse(JSON.stringify({
      severity: 'healthy',
      summary: 'All good',
      rootCauses: [],
      recommendations: [],
    }));
    expect(result.success).toBe(true);
  });

  it('accepts boundary confidence values (0 and 1)', () => {
    const result = parseLLMResponse(JSON.stringify({
      severity: 'info',
      summary: 'Test',
      rootCauses: [
        { description: 'A', confidence: 0, category: 'external', evidence: [] },
        { description: 'B', confidence: 1, category: 'tool_failure', evidence: [] },
      ],
      recommendations: [],
    }));
    expect(result.success).toBe(true);
  });
});
