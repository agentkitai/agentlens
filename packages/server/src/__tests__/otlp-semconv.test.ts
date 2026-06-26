/**
 * OTel GenAI semconv version tracking (#102).
 */

import { describe, it, expect } from 'vitest';
import { parseSemconvVersion, detectSemconvStyle } from '../routes/otlp.js';

const kv = (key: string, stringValue = 'x') => ({ key, value: { stringValue } });

describe('OTel semconv version tracking (#102)', () => {
  it('parses the version from a schema URL (trailing slash tolerated)', () => {
    expect(parseSemconvVersion('https://opentelemetry.io/schemas/1.27.0')).toBe('1.27.0');
    expect(parseSemconvVersion('https://opentelemetry.io/schemas/1.27.0/')).toBe('1.27.0');
  });

  it('returns null for missing / malformed / non-semver schema URLs', () => {
    expect(parseSemconvVersion(undefined)).toBeNull();
    expect(parseSemconvVersion('')).toBeNull();
    expect(parseSemconvVersion('not-a-schema-url')).toBeNull();
    expect(parseSemconvVersion('https://opentelemetry.io/schemas/latest')).toBeNull();
  });

  it('detects the newer structured message style', () => {
    expect(detectSemconvStyle([kv('gen_ai.input.messages', '[]')])).toBe('structured');
    expect(detectSemconvStyle([kv('gen_ai.output.messages', '[]')])).toBe('structured');
  });

  it('detects the older indexed OpenLLMetry style', () => {
    expect(detectSemconvStyle([kv('gen_ai.prompt.0.role', 'user')])).toBe('indexed');
    expect(detectSemconvStyle([kv('gen_ai.completion.0.content', 'hi')])).toBe('indexed');
  });

  it('returns null when no GenAI content-style attrs are present', () => {
    expect(detectSemconvStyle([kv('gen_ai.request.model', 'gpt-4o')])).toBeNull();
    expect(detectSemconvStyle(undefined)).toBeNull();
  });

  it('prefers structured when both styles co-exist (dual emission)', () => {
    expect(
      detectSemconvStyle([kv('gen_ai.input.messages', '[]'), kv('gen_ai.prompt.0.role', 'user')]),
    ).toBe('structured');
  });
});
