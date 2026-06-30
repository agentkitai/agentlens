/**
 * LangChain / LangGraph (JS) callback handler for AgentLens (#152).
 *
 * Usage:
 *   import { init } from '@agentkitai/agentlens-sdk';
 *   import { AgentLensCallbackHandler } from '@agentkitai/agentlens-sdk/langchain';
 *   init({ serverUrl, apiKey, agentId });
 *   await chain.invoke(input, { callbacks: [new AgentLensCallbackHandler()] });
 *
 * Emits a traced LLM call (request + response, tokens, latency, cost) per LLM run
 * — works for chains, agents, and LangGraph nodes. @langchain/core is an optional
 * peer dependency, loaded only via this subpath.
 */
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { BaseMessage } from '@langchain/core/messages';
import type { Serialized } from '@langchain/core/load/serializable';
import { getInstrumentation, type Instrumentation } from './instrumentation.js';
import type { LlmMessage } from '@agentkitai/agentlens-core';

interface RunStart {
  startedAt: number;
  model: string;
  messages: LlmMessage[];
}

export interface AgentLensCallbackHandlerOptions {
  /** Override the instrumentation; defaults to the one from init(). */
  instrumentation?: Instrumentation;
}

function providerFromModel(model: string): string {
  const m = model.toLowerCase();
  if (m.includes('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'openai';
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'google';
  if (m.includes('llama') || m.includes('mixtral') || m.includes('mistral')) return 'meta';
  return 'unknown';
}

function modelOf(extraParams: Record<string, unknown> | undefined, llm: Serialized): string {
  const inv = (extraParams?.invocation_params ?? {}) as Record<string, unknown>;
  const fromInv = inv.model ?? inv.model_name ?? inv.modelName;
  if (fromInv) return String(fromInv);
  const id = (llm as { id?: unknown }).id;
  if (Array.isArray(id) && id.length) return String(id[id.length - 1]);
  return 'unknown';
}

function roleOf(m: BaseMessage): LlmMessage['role'] {
  const t = (m as { _getType?: () => string })._getType?.() ?? 'human';
  if (t === 'human') return 'user';
  if (t === 'ai') return 'assistant';
  if (t === 'system') return 'system';
  return 'user';
}

function num(...vals: Array<unknown>): number {
  for (const v of vals) if (v != null && !Number.isNaN(Number(v))) return Number(v);
  return 0;
}

export class AgentLensCallbackHandler extends BaseCallbackHandler {
  name = 'AgentLensCallbackHandler';
  private readonly inst: Instrumentation | null;
  private readonly runs = new Map<string, RunStart>();

  constructor(options: AgentLensCallbackHandlerOptions = {}) {
    super();
    this.inst = options.instrumentation ?? getInstrumentation();
  }

  override handleLLMStart(llm: Serialized, prompts: string[], runId: string, _parentRunId?: string, extraParams?: Record<string, unknown>): void {
    this.runs.set(runId, {
      startedAt: Date.now(),
      model: modelOf(extraParams, llm),
      messages: prompts.map((p) => ({ role: 'user', content: p })),
    });
  }

  override handleChatModelStart(llm: Serialized, messages: BaseMessage[][], runId: string, _parentRunId?: string, extraParams?: Record<string, unknown>): void {
    const flat = (messages[0] ?? []).map((m) => ({ role: roleOf(m), content: String(m.content ?? '') }));
    this.runs.set(runId, { startedAt: Date.now(), model: modelOf(extraParams, llm), messages: flat });
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const start = this.runs.get(runId);
    this.runs.delete(runId);
    if (!start || !this.inst) return;

    const gen = output.generations?.[0]?.[0] as
      | { text?: string; message?: { content?: unknown } }
      | undefined;
    const completion = gen?.text ?? (gen?.message?.content != null ? String(gen.message.content) : null);

    const usage = (output.llmOutput?.tokenUsage ?? output.llmOutput?.usage ?? {}) as Record<string, unknown>;
    this.inst.capture({
      provider: providerFromModel(start.model),
      model: start.model,
      messages: start.messages,
      completion,
      finishReason: 'stop',
      usage: {
        inputTokens: num(usage.promptTokens, usage.prompt_tokens, usage.inputTokens, usage.input_tokens),
        outputTokens: num(usage.completionTokens, usage.completion_tokens, usage.outputTokens, usage.output_tokens),
        totalTokens: num(usage.totalTokens, usage.total_tokens),
      },
      latencyMs: Date.now() - start.startedAt,
    });
  }
}
