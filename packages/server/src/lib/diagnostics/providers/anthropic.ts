/**
 * Anthropic Messages Adapter (Story 18.1)
 *
 * Uses tool-use for structured JSON output. Raw fetch, no SDK.
 */

import type { LLMProvider, LLMCompletionRequest, LLMCompletionResponse } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

const COST_TABLE: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
  'claude-3-haiku-20240307': { input: 0.00025, output: 0.00125 },
  'claude-3-opus-20240229': { input: 0.015, output: 0.075 },
};

interface AnthropicMessage {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

export function createAnthropicProvider(
  apiKey: string,
  model?: string,
  baseUrl?: string,
): LLMProvider {
  const resolvedModel = model ?? DEFAULT_MODEL;
  const resolvedBaseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

  return {
    name: 'anthropic',

    async complete(req: LLMCompletionRequest): Promise<LLMCompletionResponse> {
      const start = performance.now();

      const body: Record<string, unknown> = {
        model: resolvedModel,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens ?? 4096,
      };

      // Use tool-use for structured JSON output
      if (req.jsonSchema) {
        body.tools = [
          {
            name: 'diagnostic_report',
            description: 'Submit the diagnostic report as structured JSON',
            input_schema: req.jsonSchema,
          },
        ];
        body.tool_choice = { type: 'tool', name: 'diagnostic_report' };
      }

      const response = await fetch(`${resolvedBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
      }

      const json = (await response.json()) as AnthropicMessage;
      const latencyMs = Math.round(performance.now() - start);

      // Extract content: prefer tool_use result, fall back to text
      let content = '';
      for (const block of json.content) {
        if (block.type === 'tool_use') {
          content = JSON.stringify(block.input);
          break;
        }
        if (block.type === 'text') {
          content = block.text;
        }
      }

      return {
        content,
        inputTokens: json.usage.input_tokens,
        outputTokens: json.usage.output_tokens,
        model: json.model,
        latencyMs,
      };
    },

    estimateCost(inputTokens: number, outputTokens: number): number {
      const prices = COST_TABLE[resolvedModel] ?? COST_TABLE['claude-sonnet-4-20250514']!;
      return (inputTokens / 1000) * prices.input + (outputTokens / 1000) * prices.output;
    },
  };
}
