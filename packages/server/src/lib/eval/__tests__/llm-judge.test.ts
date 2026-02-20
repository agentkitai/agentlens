/**
 * Tests for LLM Judge Scorer (Feature 15 — Story 5)
 */

import { describe, it, expect, vi } from 'vitest';
import type { EvalTestCase } from '@agentlensai/core';
import { LlmJudgeScorer, type LlmClient } from '../scorers/llm-judge.js';

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

function mockClient(response: string): LlmClient {
  return { chat: vi.fn().mockResolvedValue(response) };
}

function failingClient(error: Error): LlmClient {
  return { chat: vi.fn().mockRejectedValue(error) };
}

describe('LlmJudgeScorer', () => {
  it('parses valid LLM response', async () => {
    const client = mockClient(JSON.stringify({ score: 0.9, reasoning: 'Correct answer' }));
    const scorer = new LlmJudgeScorer(client);

    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge', model: 'gpt-4o-mini' },
    });

    expect(result.score).toBe(0.9);
    expect(result.passed).toBe(true);
    expect(result.reasoning).toBe('Correct answer');
    expect(client.chat).toHaveBeenCalledOnce();
  });

  it('uses testCase.scoringCriteria when available', async () => {
    const client = mockClient(JSON.stringify({ score: 0.8, reasoning: 'Good' }));
    const scorer = new LlmJudgeScorer(client);

    await scorer.score({
      testCase: makeTestCase({ scoringCriteria: 'Must mention the number 4' }),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });

    const prompt = (client.chat as any).mock.calls[0][1][0].content;
    expect(prompt).toContain('Must mention the number 4');
  });

  it('falls back to config.rubric', async () => {
    const client = mockClient(JSON.stringify({ score: 0.7, reasoning: 'OK' }));
    const scorer = new LlmJudgeScorer(client);

    await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge', rubric: 'Check for correctness' },
    });

    const prompt = (client.chat as any).mock.calls[0][1][0].content;
    expect(prompt).toContain('Check for correctness');
  });

  it('returns 0.5 on parse failure', async () => {
    const client = mockClient('This is not JSON');
    const scorer = new LlmJudgeScorer(client);

    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });

    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain('Parse error');
  });

  it('retries once on API error then returns 0', async () => {
    const client = failingClient(new Error('API timeout'));
    const scorer = new LlmJudgeScorer(client);

    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });

    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('API timeout');
    // Called twice (initial + retry)
    expect(client.chat).toHaveBeenCalledTimes(2);
  });

  it('clamps score to 0-1 range', async () => {
    const client = mockClient(JSON.stringify({ score: 1.5, reasoning: 'Over' }));
    const scorer = new LlmJudgeScorer(client);

    const result = await scorer.score({
      testCase: makeTestCase(),
      actualOutput: '4',
      config: { type: 'llm_judge' },
    });

    expect(result.score).toBe(1.0);
  });

  it('works without expectedOutput', async () => {
    const client = mockClient(JSON.stringify({ score: 0.6, reasoning: 'Partial' }));
    const scorer = new LlmJudgeScorer(client);

    const result = await scorer.score({
      testCase: makeTestCase({ expectedOutput: undefined }),
      actualOutput: 'some answer',
      config: { type: 'llm_judge' },
    });

    expect(result.score).toBe(0.6);
    const prompt = (client.chat as any).mock.calls[0][1][0].content;
    expect(prompt).toContain('No reference provided');
  });
});
