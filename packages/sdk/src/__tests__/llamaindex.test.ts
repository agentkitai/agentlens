/**
 * LlamaIndex.TS instrumentation (#211) — llm-start/llm-end → a traced LLM call.
 */
import { describe, it, expect } from 'vitest';
import { instrumentLlamaIndex, type LlamaIndexCallbackManager } from '../llamaindex.js';
import type { Instrumentation, LlmCapture } from '../instrumentation.js';

function mockInstrumentation(): { inst: Instrumentation; captured: LlmCapture[] } {
  const captured: LlmCapture[] = [];
  const inst = { capture: (c: LlmCapture) => captured.push(c) } as unknown as Instrumentation;
  return { inst, captured };
}

/** A fake CallbackManager that lets the test fire events. */
function mockCallbackManager(): { cm: LlamaIndexCallbackManager; fire: (e: string, detail: unknown) => void } {
  const handlers: Record<string, (event: { detail?: unknown }) => void> = {};
  const cm: LlamaIndexCallbackManager = { on: (event, handler) => { handlers[event] = handler; } };
  return { cm, fire: (e, detail) => handlers[e]?.({ detail }) };
}

describe('instrumentLlamaIndex (#211)', () => {
  it('captures an llm run with messages, completion, tokens, and model', () => {
    const { inst, captured } = mockInstrumentation();
    const { cm, fire } = mockCallbackManager();
    instrumentLlamaIndex(cm, { instrumentation: inst });

    fire('llm-start', { id: 'r1', messages: [{ role: 'system', content: 'be nice' }, { role: 'user', content: 'hi' }] });
    fire('llm-end', {
      id: 'r1',
      response: {
        message: { role: 'assistant', content: 'hello!' },
        raw: { model: 'gpt-4o', usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } },
      },
    });

    expect(captured).toHaveLength(1);
    const c = captured[0]!;
    expect(c.provider).toBe('openai');
    expect(c.model).toBe('gpt-4o');
    expect(c.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hi' },
    ]);
    expect(c.completion).toBe('hello!');
    expect(c.usage).toMatchObject({ inputTokens: 11, outputTokens: 3, totalTokens: 14 });
  });

  it('falls back to the options.model when the event omits it', () => {
    const { inst, captured } = mockInstrumentation();
    const { cm, fire } = mockCallbackManager();
    instrumentLlamaIndex(cm, { instrumentation: inst, model: 'claude-3-5-sonnet' });
    fire('llm-start', { id: 'r2', messages: [{ role: 'user', content: 'q' }] });
    fire('llm-end', { id: 'r2', response: { message: { content: 'a' }, raw: {} } });
    expect(captured[0]!.provider).toBe('anthropic');
    expect(captured[0]!.model).toBe('claude-3-5-sonnet');
  });

  it('handles an llm-end with no matching start (no throw)', () => {
    const { inst, captured } = mockInstrumentation();
    const { cm, fire } = mockCallbackManager();
    instrumentLlamaIndex(cm, { instrumentation: inst });
    fire('llm-end', { id: 'unknown', response: { message: { content: 'x' }, raw: { model: 'gpt-4o' } } });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.messages).toEqual([]);
  });
});
