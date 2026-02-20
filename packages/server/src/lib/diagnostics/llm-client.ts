/**
 * LLM Client Factory (Story 18.1)
 *
 * Creates the appropriate LLM provider based on configuration.
 */

import type { LLMProvider } from './providers/types.js';
import { createOpenAIProvider } from './providers/openai.js';
import { createAnthropicProvider } from './providers/anthropic.js';

export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  apiKey: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}

/**
 * Create an LLM provider from configuration.
 */
export function createLLMProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'openai':
      return createOpenAIProvider(config.apiKey, config.model, config.baseUrl);
    case 'anthropic':
      return createAnthropicProvider(config.apiKey, config.model, config.baseUrl);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

/**
 * Read LLM configuration from environment variables.
 * Returns null if AGENTLENS_LLM_API_KEY is not set (feature disabled gracefully).
 */
export function getLLMConfigFromEnv(): LLMConfig | null {
  const apiKey = process.env['AGENTLENS_LLM_API_KEY'];
  if (!apiKey) return null;

  return {
    provider: (process.env['AGENTLENS_LLM_PROVIDER'] as 'openai' | 'anthropic') ?? 'openai',
    apiKey,
    model: process.env['AGENTLENS_LLM_MODEL'] || undefined,
    temperature: process.env['AGENTLENS_LLM_TEMPERATURE']
      ? parseFloat(process.env['AGENTLENS_LLM_TEMPERATURE'])
      : undefined,
    maxTokens: process.env['AGENTLENS_LLM_MAX_TOKENS']
      ? parseInt(process.env['AGENTLENS_LLM_MAX_TOKENS'], 10)
      : undefined,
    baseUrl: process.env['AGENTLENS_LLM_BASE_URL'] || undefined,
  };
}
