/**
 * OpenAI Node SDK drop-in instrumentation (#123).
 *
 *   import OpenAI from 'openai';
 *   import { init } from '@agentkitai/agentlens-sdk';
 *   import { instrumentOpenAI } from '@agentkitai/agentlens-sdk/openai';
 *   init({ agentId: 'my-agent', agentToken });
 *   const client = instrumentOpenAI(new OpenAI());
 *
 * Duck-typed (no `openai` dependency): wraps `chat.completions.create` for both
 * sync and streaming. Captures model/messages/usage/tool-calls/finish-reason +
 * capture-time cost, paired llm_call/llm_response. Fail-safe: capture never
 * throws into user code and never alters the returned value or stream.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LlmMessage } from '@agentkitai/agentlens-core';
import { getInstrumentation, type Instrumentation, type LlmCapture } from './instrumentation.js';

export interface InstrumentOpenAIOptions {
  /** Instrumentation to use (defaults to the init()'d singleton). */
  instrumentation?: Instrumentation;
}

export function instrumentOpenAI<T>(client: T, options: InstrumentOpenAIOptions = {}): T {
  const resolve = (): Instrumentation | null => options.instrumentation ?? getInstrumentation();
  const c = client as any;

  const completions = c?.chat?.completions;
  if (completions && typeof completions.create === 'function' && !completions.__agentlensWrapped) {
    const original = completions.create.bind(completions);
    completions.create = wrapCreate(original, resolve);
    completions.__agentlensWrapped = true;
  }
  return client;
}

function wrapCreate(original: (...a: any[]) => any, resolve: () => Instrumentation | null) {
  return async function (params: any, ...rest: any[]): Promise<any> {
    const start = Date.now();
    const result = await original(params, ...rest);
    const inst = resolve();
    if (!inst) return result;

    const streaming = params?.stream === true || (result && typeof result[Symbol.asyncIterator] === 'function');
    if (streaming) return wrapStream(result, params, start, inst);

    try {
      inst.capture(extractNonStream(params, result, Date.now() - start));
    } catch {
      /* fail-safe: capture must never break the user's call */
    }
    return result;
  };
}

function toMessages(params: any): LlmMessage[] {
  const msgs = Array.isArray(params?.messages) ? params.messages : [];
  return msgs.map((m: any) => ({
    role: String(m?.role ?? 'user'),
    content: typeof m?.content === 'string' ? m.content : (m?.content ?? ''),
  })) as LlmMessage[];
}

function safeArgs(s: any): Record<string, unknown> {
  if (s && typeof s === 'object') return s as Record<string, unknown>;
  if (typeof s !== 'string') return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : { value: v };
  } catch {
    return { raw: s };
  }
}

function extractToolCalls(msg: any): LlmCapture['toolCalls'] {
  if (!Array.isArray(msg?.tool_calls)) return undefined;
  return msg.tool_calls.map((t: any) => ({
    id: String(t?.id ?? ''),
    name: String(t?.function?.name ?? t?.name ?? ''),
    arguments: safeArgs(t?.function?.arguments),
  }));
}

function extractNonStream(params: any, result: any, latencyMs: number): LlmCapture {
  const choice = result?.choices?.[0];
  const msg = choice?.message ?? {};
  const usage = result?.usage ?? {};
  return {
    provider: 'openai',
    model: String(result?.model ?? params?.model ?? 'unknown'),
    messages: toMessages(params),
    completion: typeof msg.content === 'string' ? msg.content : null,
    finishReason: String(choice?.finish_reason ?? 'stop'),
    usage: {
      inputTokens: Number(usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
      cacheReadTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0) || undefined,
    },
    latencyMs,
    toolCalls: extractToolCalls(msg),
  };
}

async function* wrapStream(stream: any, params: any, start: number, inst: Instrumentation): AsyncGenerator<any> {
  let content = '';
  let finishReason = 'stop';
  let model = String(params?.model ?? 'unknown');
  let usage: any = null;
  try {
    for await (const chunk of stream) {
      const choice = chunk?.choices?.[0];
      if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
      if (choice?.finish_reason) finishReason = String(choice.finish_reason);
      if (chunk?.model) model = String(chunk.model);
      if (chunk?.usage) usage = chunk.usage; // present when stream_options.include_usage
      yield chunk;
    }
  } finally {
    try {
      inst.capture({
        provider: 'openai',
        model,
        messages: toMessages(params),
        completion: content || null,
        finishReason,
        usage: {
          inputTokens: Number(usage?.prompt_tokens ?? 0),
          outputTokens: Number(usage?.completion_tokens ?? 0),
          totalTokens: Number(usage?.total_tokens ?? 0),
        },
        latencyMs: Date.now() - start,
      });
    } catch {
      /* fail-safe */
    }
  }
}
