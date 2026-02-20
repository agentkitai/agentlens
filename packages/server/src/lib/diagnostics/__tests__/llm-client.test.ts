/**
 * Tests for LLM Client (Story 18.1)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLLMProvider, getLLMConfigFromEnv } from '../llm-client.js';

describe('createLLMProvider', () => {
  it('creates openai provider', () => {
    const provider = createLLMProvider({ provider: 'openai', apiKey: 'test-key' });
    expect(provider.name).toBe('openai');
  });

  it('creates anthropic provider', () => {
    const provider = createLLMProvider({ provider: 'anthropic', apiKey: 'test-key' });
    expect(provider.name).toBe('anthropic');
  });

  it('throws for unknown provider', () => {
    expect(() =>
      createLLMProvider({ provider: 'unknown' as any, apiKey: 'test-key' }),
    ).toThrow('Unknown LLM provider');
  });
});

describe('getLLMConfigFromEnv', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns null when AGENTLENS_LLM_API_KEY is not set', () => {
    delete process.env['AGENTLENS_LLM_API_KEY'];
    expect(getLLMConfigFromEnv()).toBeNull();
  });

  it('returns config when API key is set', () => {
    process.env['AGENTLENS_LLM_API_KEY'] = 'sk-test';
    process.env['AGENTLENS_LLM_PROVIDER'] = 'anthropic';
    process.env['AGENTLENS_LLM_MODEL'] = 'claude-3-haiku-20240307';
    const config = getLLMConfigFromEnv();
    expect(config).not.toBeNull();
    expect(config!.provider).toBe('anthropic');
    expect(config!.model).toBe('claude-3-haiku-20240307');
  });

  it('defaults to openai provider', () => {
    process.env['AGENTLENS_LLM_API_KEY'] = 'sk-test';
    delete process.env['AGENTLENS_LLM_PROVIDER'];
    const config = getLLMConfigFromEnv();
    expect(config!.provider).toBe('openai');
  });

  it('supports baseUrl override', () => {
    process.env['AGENTLENS_LLM_API_KEY'] = 'sk-test';
    process.env['AGENTLENS_LLM_BASE_URL'] = 'http://localhost:8080';
    const config = getLLMConfigFromEnv();
    expect(config!.baseUrl).toBe('http://localhost:8080');
  });
});
