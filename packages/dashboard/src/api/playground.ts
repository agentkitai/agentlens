/**
 * Playground run (#144) — execute a prompt against a stored LLM connection.
 */
import { request } from './core';

export interface PlaygroundRunBody {
  connectionId: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  promptId?: string;
  versionId?: string;
  variables?: Record<string, string | number | boolean>;
}

export interface PlaygroundRunResult {
  output: { content: string; model: string; usage: { inputTokens: number; outputTokens: number }; finishReason?: string };
  costUsd: number;
  latencyMs: number;
}

export function runPlayground(body: PlaygroundRunBody): Promise<PlaygroundRunResult> {
  return request('/api/playground/run', { method: 'POST', body: JSON.stringify(body) });
}
