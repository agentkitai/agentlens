/**
 * LangChain/LangGraph JS callback handler (#152) — captures a traced LLM call.
 */
import { describe, it, expect } from 'vitest';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { LLMResult } from '@langchain/core/outputs';
import type { Serialized } from '@langchain/core/load/serializable';
import { AgentLensCallbackHandler } from '../langchain.js';
import type { Instrumentation, LlmCapture } from '../instrumentation.js';

function mockInstrumentation(): { inst: Instrumentation; captured: LlmCapture[] } {
  const captured: LlmCapture[] = [];
  const inst = { capture: (c: LlmCapture) => captured.push(c) } as unknown as Instrumentation;
  return { inst, captured };
}

const serialized = (model: string): Serialized =>
  ({ lc: 1, type: 'not_implemented', id: ['langchain', 'chat_models', 'openai', 'ChatOpenAI'], model }) as unknown as Serialized;

describe('AgentLensCallbackHandler (LangChain JS, #152)', () => {
  it('captures a chat-model run as a traced LLM call with tokens + role mapping', () => {
    const { inst, captured } = mockInstrumentation();
    const handler = new AgentLensCallbackHandler({ instrumentation: inst });

    handler.handleChatModelStart(
      serialized('gpt-4o'),
      [[new SystemMessage('You are helpful'), new HumanMessage('hi there')]],
      'run-1',
      undefined,
      { invocation_params: { model: 'gpt-4o' } },
    );
    handler.handleLLMEnd(
      {
        generations: [[{ text: 'hello!', message: { content: 'hello!' } }]],
        llmOutput: { tokenUsage: { promptTokens: 12, completionTokens: 4, totalTokens: 16 } },
      } as unknown as LLMResult,
      'run-1',
    );

    expect(captured).toHaveLength(1);
    const c = captured[0]!;
    expect(c.provider).toBe('openai');
    expect(c.model).toBe('gpt-4o');
    expect(c.messages).toEqual([
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hi there' },
    ]);
    expect(c.completion).toBe('hello!');
    expect(c.usage).toMatchObject({ inputTokens: 12, outputTokens: 4, totalTokens: 16 });
    expect(c.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('captures a completion (string-prompt) LLM run', () => {
    const { inst, captured } = mockInstrumentation();
    const handler = new AgentLensCallbackHandler({ instrumentation: inst });
    handler.handleLLMStart(serialized('claude-3-5-sonnet'), ['summarize this'], 'run-2', undefined, {
      invocation_params: { model: 'claude-3-5-sonnet' },
    });
    handler.handleLLMEnd(
      { generations: [[{ text: 'summary' }]], llmOutput: { tokenUsage: { prompt_tokens: 8, completion_tokens: 2 } } } as unknown as LLMResult,
      'run-2',
    );
    expect(captured[0]!.provider).toBe('anthropic');
    expect(captured[0]!.messages).toEqual([{ role: 'user', content: 'summarize this' }]);
    expect(captured[0]!.usage).toMatchObject({ inputTokens: 8, outputTokens: 2 });
  });

  it('ignores an unmatched LLM end (no start)', () => {
    const { inst, captured } = mockInstrumentation();
    const handler = new AgentLensCallbackHandler({ instrumentation: inst });
    handler.handleLLMEnd({ generations: [[{ text: 'x' }]] } as unknown as LLMResult, 'unknown-run');
    expect(captured).toHaveLength(0);
  });
});
