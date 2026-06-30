/**
 * LlamaIndex (JS / LlamaIndex.TS) instrumentation for AgentLens (#211).
 *
 * Usage:
 *   import { init } from '@agentkitai/agentlens-sdk';
 *   import { instrumentLlamaIndex } from '@agentkitai/agentlens-sdk/llamaindex';
 *   import { Settings } from 'llamaindex';
 *   init({ serverUrl, apiKey, agentId });
 *   instrumentLlamaIndex(Settings.callbackManager);
 *
 * Registers `llm-start`/`llm-end` handlers on the LlamaIndex CallbackManager and
 * emits a traced LLM call per run. Dependency-free: it only needs an object with
 * `.on(event, handler)`, so it works with any LlamaIndex.TS version without a
 * type/peer dependency.
 */
import { getInstrumentation, type Instrumentation } from './instrumentation.js';
import type { LlmMessage } from '@agentkitai/agentlens-core';

export interface LlamaIndexInstrumentOptions {
  /** Override the instrumentation; defaults to the one from init(). */
  instrumentation?: Instrumentation;
  /** Fallback model name when the LlamaIndex event doesn't carry one. */
  model?: string;
}

/** The slice of LlamaIndex's CallbackManager we use. */
export interface LlamaIndexCallbackManager {
  on(event: string, handler: (event: { detail?: unknown }) => void): unknown;
}

function providerFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'google';
  if (m.includes('llama') || m.includes('mixtral') || m.includes('mistral')) return 'meta';
  return 'unknown';
}

function num(...vals: Array<unknown>): number {
  for (const v of vals) if (v != null && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}

function roleOf(role: unknown): LlmMessage['role'] {
  const r = String(role ?? 'user').toLowerCase();
  if (r === 'assistant' || r === 'ai') return 'assistant';
  if (r === 'system') return 'system';
  if (r === 'tool' || r === 'function') return 'tool';
  return 'user';
}

function extractMessages(messages: unknown): LlmMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const o = (m ?? {}) as Record<string, unknown>;
    return { role: roleOf(o.role), content: String(o.content ?? '') };
  });
}

export function instrumentLlamaIndex(
  callbackManager: LlamaIndexCallbackManager,
  options: LlamaIndexInstrumentOptions = {},
): void {
  const inst = options.instrumentation ?? getInstrumentation();
  if (!inst) return;
  const starts = new Map<string, { startedAt: number; messages: LlmMessage[] }>();

  callbackManager.on('llm-start', (event) => {
    const d = (event?.detail ?? {}) as Record<string, unknown>;
    starts.set(String(d.id ?? ''), { startedAt: Date.now(), messages: extractMessages(d.messages) });
  });

  callbackManager.on('llm-end', (event) => {
    const d = (event?.detail ?? {}) as Record<string, unknown>;
    const id = String(d.id ?? '');
    const start = starts.get(id);
    starts.delete(id);

    const response = (d.response ?? {}) as Record<string, unknown>;
    const message = (response.message ?? {}) as Record<string, unknown>;
    const completion = message.content != null ? String(message.content) : null;
    const raw = (response.raw ?? {}) as Record<string, unknown>;
    const usage = (raw.usage ?? {}) as Record<string, unknown>;
    const model = String(raw.model ?? options.model ?? 'unknown');

    inst.capture({
      provider: providerFromModel(model),
      model,
      messages: start?.messages ?? [],
      completion,
      finishReason: 'stop',
      usage: {
        inputTokens: num(usage.prompt_tokens, usage.promptTokens, usage.input_tokens, usage.inputTokens),
        outputTokens: num(usage.completion_tokens, usage.completionTokens, usage.output_tokens, usage.outputTokens),
        totalTokens: num(usage.total_tokens, usage.totalTokens),
      },
      latencyMs: start ? Date.now() - start.startedAt : 0,
    });
  });
}
