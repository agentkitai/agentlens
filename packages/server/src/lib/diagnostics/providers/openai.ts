/**
 * OpenAI Chat Completions Adapter (Story 18.1)
 *
 * Uses raw fetch — no SDK dependency. Consistent with embeddings/openai.ts pattern.
 */

import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from './types.js';

const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_BASE_URL = 'https://api.openai.com';

/** Per-model token pricing (USD per 1K tokens) */
const COST_TABLE: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
};

interface OpenAIChatResponse {
  choices: Array<{
    message: { content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model: string;
}

export function createOpenAIProvider(
  apiKey: string,
  model?: string,
  baseUrl?: string,
): LLMProvider {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const resolvedBaseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  return {
    name: 'openai',

    async complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      const start = performance.now();

      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 4096,
      };

      if (req.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'diagnostic_report',
            strict: true,
            schema: req.jsonSchema,
          },
        };
      }

      const response = await fetch(`${resolvedBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error (${response.status}): ${errorBody}`);
      }

      const json = (await response.json()) as OpenAIChatResponse;
      const latencyMs = Math.round(performance.now() - start);

      return {
        content: json.choices[0]?.message.content ?? '',
        inputTokens: json.usage.prompt_tokens,
        outputTokens: json.usage.completion_tokens,
        model: json.model,
        latencyMs,
      };
    },

    estimateCost(inputTokens: number, outputTokens: number): number {
      const prices = COST_TABLE[resolvedModel] ?? COST_TABLE['gpt-4o']!;
      return (inputTokens / 1000) * prices.input + (outputTokens / 1000) * prices.output;
    },
  };
}
