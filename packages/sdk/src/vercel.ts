/**
 * Vercel AI SDK drop-in instrumentation (#123) — a LanguageModelV1 middleware.
 *
 *   import { wrapLanguageModel } from 'ai';
 *   import { openai } from '@ai-sdk/openai';
 *   import { init } from '@agentkitai/agentlens-sdk';
 *   import { agentlensMiddleware } from '@agentkitai/agentlens-sdk/vercel';
 *   init({ agentId: 'my-agent', agentToken });
 *   const model = wrapLanguageModel({ model: openai('gpt-4o'), middleware: agentlensMiddleware() });
 *
 * Captures generateText/streamText (and tool calls) with capture-time cost +
 * verified identity. Duck-typed (no `ai` dependency); fail-safe — never throws
 * into user code and never alters the result or stream.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LlmMessage } from '@agentkitai/agentlens-core';
import { getInstrumentation, type Instrumentation, type LlmCapture } from './instrumentation.js';

export interface AgentLensMiddlewareOptions {
  /** Instrumentation to use (defaults to the init()'d singleton). */
  instrumentation?: Instrumentation;
}

export function agentlensMiddleware(options: AgentLensMiddlewareOptions = {}) {
  const resolve = (): Instrumentation | null => options.instrumentation ?? getInstrumentation();

  return {
    async wrapGenerate({ doGenerate, params, model }: any): Promise<any> {
      const start = Date.now();
      const result = await doGenerate();
      const inst = resolve();
      if (inst) {
        try {
          inst.capture(buildCapture(params, model, result?.text ?? null, result?.usage, result?.finishReason, result?.toolCalls, Date.now() - start));
        } catch {
          /* fail-safe */
        }
      }
      return result;
    },

    async wrapStream({ doStream, params, model }: any): Promise<any> {
      const start = Date.now();
      const inst = resolve();
      const out = await doStream();
      if (!inst || !out?.stream || typeof out.stream.pipeThrough !== 'function') return out;

      let text = '';
      let usage: any;
      let finishReason = 'stop';
      let toolCalls: any[] | undefined;
      const transform = new TransformStream({
        transform(part: any, controller: any) {
          if (part?.type === 'text-delta' && typeof part.textDelta === 'string') text += part.textDelta;
          else if (part?.type === 'tool-call') (toolCalls ??= []).push(part);
          else if (part?.type === 'finish') {
            usage = part.usage;
            if (part.finishReason) finishReason = String(part.finishReason);
          }
          controller.enqueue(part);
        },
        flush() {
          try {
            inst.capture(buildCapture(params, model, text || null, usage, finishReason, toolCalls, Date.now() - start));
          } catch {
            /* fail-safe */
          }
        },
      });
      return { ...out, stream: out.stream.pipeThrough(transform) };
    },
  };
}

function promptToMessages(params: any): LlmMessage[] {
  const prompt = params?.prompt;
  if (typeof prompt === 'string') return [{ role: 'user', content: prompt }];
  if (!Array.isArray(prompt)) return [];
  return prompt.map((m: any) => {
    let content = '';
    if (typeof m?.content === 'string') content = m.content;
    else if (Array.isArray(m?.content)) {
      content = m.content
        .map((p: any) => (typeof p?.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('');
    }
    return { role: String(m?.role ?? 'user'), content };
  }) as LlmMessage[];
}

function buildCapture(
  params: any,
  model: any,
  completion: string | null,
  usage: any,
  finishReason: any,
  toolCalls: any[] | undefined,
  latencyMs: number,
): LlmCapture {
  return {
    provider: String(model?.provider ?? 'vercel'),
    model: String(model?.modelId ?? params?.model ?? 'unknown'),
    messages: promptToMessages(params),
    completion,
    finishReason: String(finishReason ?? 'stop'),
    usage: {
      // Vercel usage: { promptTokens, completionTokens } (or inputTokens/outputTokens in newer versions).
      inputTokens: Number(usage?.promptTokens ?? usage?.inputTokens ?? 0),
      outputTokens: Number(usage?.completionTokens ?? usage?.outputTokens ?? 0),
      totalTokens: Number(usage?.totalTokens ?? 0),
    },
    latencyMs,
    toolCalls: toolCalls
      ? toolCalls.map((t: any) => ({
          id: String(t?.toolCallId ?? t?.id ?? ''),
          name: String(t?.toolName ?? t?.name ?? ''),
          arguments: (t?.args && typeof t.args === 'object' ? t.args : {}) as Record<string, unknown>,
        }))
      : undefined,
  };
}
