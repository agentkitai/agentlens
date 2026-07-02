/**
 * Tests for LLM Judge Scorer (Feature 15 — Story 5; #55 Phase 2)
 *
 * The judge now calls a real LLMProvider (injected via a model→provider factory)
 * and captures the judge's own model + token cost on the ScoreResult.
 */

import { describe, it, expect, vi } from 'vitest';
import type { EvalTestCase } from '@agentkitai/agentlens-core';
import { LlmJudgeScorer, judgeWithLlm, JUDGE_SCHEMA, type JudgeProviderFactory } from '../scorers/llm-judge.js';
import type { LLMProvider, LLMCompletionResponse } from '../../diagnostics/providers/types.js';

function makeTestCase(overrides: Partial<EvalTestCase> = {}): EvalTestCase {
  return {
    id: 'tc-1',
    datasetId: 'ds-1',
    tenantId: 't1',
    input: { prompt: 'What is 2+2?' },
    expectedOutput: '4',
    tags: [],
    metadata: {},
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A fake provider factory that returns a canned completion. */
function fakeFactory(
  resp: Partial<LLMCompletionResponse>,
  complete?: LLMProvider['complete'],
): { factory: JudgeProviderFactory; complete: ReturnType<typeof vi.fn> } {
  const full: LLMCompletionResponse = {
    content: '',
    inputTokens: 1000,
    outputTokens: 500,
    model: 'claude-haiku-4-5-20251001',
    latencyMs: 5,
    ...resp,
  };
  const completeFn = complete ? vi.fn(complete) : vi.fn(async () => full);
  const factory: JudgeProviderFactory = (model) => ({
    name: 'fake',
    complete: completeFn,
    estimateCost: () => 0,
    // model is captured per-factory-call; surface it for assertions if needed.
    _model: model,
  }) as unknown as LLMProvider;
  return { factory, complete: completeFn };
}

describe('LlmJudgeScorer', () => {
  it('parses a valid response and captures model + cost', async () => {
    const { factory } = fakeFactory({ content: JSON.stringify({ score: 0.9, reasoning: 'Correct answer' }) });
    const scorer = new LlmJudgeScorer(factory);

    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge', model: 'claude-haiku-4-5' },
    });

    expect(result.score).toBe(0.9);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe('Correct answer');
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(result.tokenCount).toBe(1500);
    // claude-haiku-4-5 = $0.8/$4 per 1M → (1000*0.8 + 500*4)/1e6 = 0.0028
    expect(result.costUsd).toBeCloseTo(0.0028, 6);
  });

  it('returns a clear error result when no provider is configured', async () => {
    const scorer = new LlmJudgeScorer(null);
    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.reasoning).toContain('not configured');
  });

  it('uses testCase.scoringCriteria, then config.rubric', async () => {
    const a = fakeFactory({ content: JSON.stringify({ score: 0.8, reasoning: 'Good' }) });
    await new LlmJudgeScorer(a.factory).score({
      testCase: makeTestCase({ scoringCriteria: 'Must mention the number 4' }),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect((a.complete.mock.calls[0][0] as any).userPrompt).toContain('Must mention the number 4');

    const b = fakeFactory({ content: JSON.stringify({ score: 0.7, reasoning: 'OK' }) });
    await new LlmJudgeScorer(b.factory).score({
      testCase: makeTestCase({ scoringCriteria: undefined }),
      actualOutput: '4',
      config: { type: 'llm_judge', rubric: 'Check for correctness' },
    });
    expect((b.complete.mock.calls[0][0] as any).userPrompt).toContain('Check for correctness');
  });

  it('returns 0.5 on parse failure but still records cost', async () => {
    const { factory } = fakeFactory({ content: 'This is not JSON' });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain('Parse error');
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it('retries once on API error then returns 0', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('API timeout'));
    const factory: JudgeProviderFactory = () =>
      ({ name: 'fake', complete, estimateCost: () => 0 }) as unknown as LLMProvider;
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('API timeout');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('clamps score to 0-1', async () => {
    const { factory } = fakeFactory({ content: JSON.stringify({ score: 1.5, reasoning: 'Over' }) });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(1.0);
  });

  it('works without expectedOutput', async () => {
    const { factory, complete } = fakeFactory({ content: JSON.stringify({ score: 0.6, reasoning: 'Partial' }) });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase({ expectedOutput: undefined }),
      actualOutput: 'some answer',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(0.6);
    expect((complete.mock.calls[0][0] as any).userPrompt).toContain('No reference provided');
  });

  it('records $0 and warns when the judge model is unpriced', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { factory } = fakeFactory({
      content: JSON.stringify({ score: 0.8, reasoning: 'ok' }),
      model: 'mystery-model-x',
    });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.model).toBe('mystery-model-x');
    expect(result.costUsd).toBe(0);
    expect(result.tokenCount).toBe(1500);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mystery-model-x'));
    warn.mockRestore();
  });

  it('flags a non-numeric score in the reasoning and defaults to 0.5', async () => {
    const { factory } = fakeFactory({ content: JSON.stringify({ score: '0.8', reasoning: 'Good' }) });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain('non-numeric');
    expect(result.reasoning).toContain('Good');
  });

  it('error path keeps a consistent shape (zeroed cost, attempted model)', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('boom'));
    const factory: JudgeProviderFactory = () =>
      ({ name: 'fake', complete, estimateCost: () => 0 }) as unknown as LLMProvider;
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge', model: 'claude-haiku-4-5' },
    });
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.costUsd).toBe(0);
    expect(result.tokenCount).toBe(0);
  });

  it('never throws on a non-serializable actualOutput', async () => {
    const circular: any = {};
    circular.self = circular;
    const { factory } = fakeFactory({ content: JSON.stringify({ score: 1, reasoning: 'ok' }) });
    const result = await new LlmJudgeScorer(factory).score({
      testCase: makeTestCase({ expectedOutput: undefined }),
      actualOutput: circular,
      config: { type: 'llm_judge' },
    });
    expect(result.score).toBe(1);
  });

  it('judgeWithLlm uses the default model when none is given', async () => {
    const seen: string[] = [];
    const factory: JudgeProviderFactory = (model) => {
      seen.push(model);
      return {
        name: 'fake',
        complete: vi.fn(async () => ({
          content: JSON.stringify({ score: 1, reasoning: 'ok' }),
          inputTokens: 10,
          outputTokens: 10,
          model,
          latencyMs: 1,
        })),
        estimateCost: () => 0,
      } as unknown as LLMProvider;
    };
    await judgeWithLlm({ makeProvider: factory, rubric: 'r', inputPrompt: 'i', actualOutput: 'a' });
    expect(seen[0]).toBe('claude-haiku-4-5');
  });
});

describe('JUDGE_SCHEMA (OpenAI strict Structured Outputs)', () => {
  it('sets additionalProperties:false so OpenAI accepts the json_schema (else the judge 400s → 0 score)', () => {
    expect((JUDGE_SCHEMA as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });
});
