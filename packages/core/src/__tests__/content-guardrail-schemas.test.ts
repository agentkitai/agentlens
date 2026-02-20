/**
 * Tests for Feature 8 content guardrail config schemas [F8-S1]
 */
import { describe, it, expect } from 'vitest';
import {
  PiiDetectionConfigSchema,
  SecretsDetectionConfigSchema,
  ContentRegexConfigSchema,
  ToxicityDetectionConfigSchema,
  PromptInjectionConfigSchema,
  BlockActionConfigSchema,
  RedactActionConfigSchema,
  LogAndContinueActionConfigSchema,
  AlertActionConfigSchema,
} from '../guardrail-config-schemas.js';

describe('PiiDetectionConfigSchema', () => {
  it('accepts valid config with defaults', () => {
    const result = PiiDetectionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patterns).toEqual(['ssn', 'credit_card', 'email', 'phone_us']);
      expect(result.data.minConfidence).toBe(0.8);
    }
  });

  it('accepts custom patterns', () => {
    const result = PiiDetectionConfigSchema.safeParse({
      patterns: ['ssn', 'email'],
      customPatterns: { my_id: '\\d{8}' },
      minConfidence: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid pattern name', () => {
    const result = PiiDetectionConfigSchema.safeParse({
      patterns: ['invalid_type'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range confidence', () => {
    const result = PiiDetectionConfigSchema.safeParse({ minConfidence: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('SecretsDetectionConfigSchema', () => {
  it('accepts valid config with defaults', () => {
    const result = SecretsDetectionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.patterns).toContain('aws_access_key');
    }
  });

  it('rejects invalid pattern name', () => {
    const result = SecretsDetectionConfigSchema.safeParse({
      patterns: ['nonexistent'],
    });
    expect(result.success).toBe(false);
  });
});

describe('ContentRegexConfigSchema', () => {
  it('requires pattern', () => {
    const result = ContentRegexConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid pattern with defaults', () => {
    const result = ContentRegexConfigSchema.safeParse({ pattern: '\\d+' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.flags).toBe('gi');
      expect(result.data.patternName).toBe('custom_match');
    }
  });
});

describe('ToxicityDetectionConfigSchema', () => {
  it('defaults to local_wordlist', () => {
    const result = ToxicityDetectionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.backend).toBe('local_wordlist');
    }
  });
});

describe('PromptInjectionConfigSchema', () => {
  it('defaults to medium sensitivity', () => {
    const result = PromptInjectionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sensitivity).toBe('medium');
    }
  });
});

describe('BlockActionConfigSchema', () => {
  it('accepts empty config with defaults', () => {
    const result = BlockActionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe('Request blocked by content guardrail policy');
      expect(result.data.includeDetails).toBe(false);
    }
  });
});

describe('RedactActionConfigSchema', () => {
  it('accepts empty config with defaults', () => {
    const result = RedactActionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.replacementFormat).toBe('[{TYPE}_REDACTED]');
    }
  });
});

describe('LogAndContinueActionConfigSchema', () => {
  it('defaults to warn severity', () => {
    const result = LogAndContinueActionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logSeverity).toBe('warn');
    }
  });
});

describe('AlertActionConfigSchema', () => {
  it('accepts empty config', () => {
    const result = AlertActionConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid webhook URL', () => {
    const result = AlertActionConfigSchema.safeParse({ webhookUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });
});
