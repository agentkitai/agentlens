/**
 * Tests for MCP Guardrail Middleware (Feature 8 — Story 10) [F8-S10]
 */
import { describe, it, expect, vi } from 'vitest';
import { guardrailWrap, type ContentGuardrailEvaluator, type ContentGuardrailResult } from '../guardrail-middleware.js';

function mockEvaluator(result: ContentGuardrailResult): ContentGuardrailEvaluator {
  return { evaluateContent: vi.fn().mockResolvedValue(result) };
}

const allowResult: ContentGuardrailResult = {
  decision: 'allow', matches: [], evaluationMs: 1, rulesEvaluated: 0,
};
const blockResult: ContentGuardrailResult = {
  decision: 'block', matches: [{ conditionType: 'pii_detection', patternName: 'ssn', offset: { start: 0, end: 11 }, confidence: 0.95, redactionToken: '[SSN]' }],
  blockingRuleId: 'r1', evaluationMs: 1, rulesEvaluated: 1,
};
const redactResult: ContentGuardrailResult = {
  decision: 'redact', matches: [], redactedContent: '{"text":"[REDACTED]"}', evaluationMs: 1, rulesEvaluated: 1,
};

const mockHandler = vi.fn().mockResolvedValue({
  content: [{ type: 'text', text: 'Hello world' }],
});

describe('guardrailWrap', () => {
  it('passes through when no agentId', async () => {
    const evaluator = mockEvaluator(allowResult);
    const wrapped = guardrailWrap(mockHandler, {
      toolName: 'test', getAgentId: () => undefined, getTenantId: () => 'default', evaluator,
    });
    await wrapped({ text: 'hello' });
    expect(mockHandler).toHaveBeenCalled();
    expect(evaluator.evaluateContent).not.toHaveBeenCalled();
  });

  it('allows when evaluator returns allow', async () => {
    const evaluator = mockEvaluator(allowResult);
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    const result = await wrapped({ text: 'hello' });
    expect(handler).toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
  });

  it('blocks on input when evaluator returns block', async () => {
    const evaluator = mockEvaluator(blockResult);
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    const result = await wrapped({ text: '123-45-6789' });
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('blocked');
  });

  it('redacts input when evaluator returns redact', async () => {
    const evaluator = mockEvaluator(redactResult);
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    await wrapped({ text: '123-45-6789' });
    // Handler should be called with redacted args
    expect(handler).toHaveBeenCalledWith({ text: '[REDACTED]' });
  });

  it('blocks output when evaluator returns block', async () => {
    // Allow input, block output
    const evaluator: ContentGuardrailEvaluator = {
      evaluateContent: vi.fn()
        .mockResolvedValueOnce(allowResult)  // input scan
        .mockResolvedValueOnce(blockResult), // output scan
    };
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sensitive output' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    const result = await wrapped({ text: 'hello' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('response blocked');
  });

  it('redacts output when evaluator returns redact', async () => {
    const outputRedact: ContentGuardrailResult = {
      decision: 'redact', matches: [], redactedContent: 'Safe output', evaluationMs: 1, rulesEvaluated: 1,
    };
    const evaluator: ContentGuardrailEvaluator = {
      evaluateContent: vi.fn()
        .mockResolvedValueOnce(allowResult)
        .mockResolvedValueOnce(outputRedact),
    };
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'sensitive' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    const result = await wrapped({});
    expect(result.content[0].text).toBe('Safe output');
  });

  it('fails open on evaluator error', async () => {
    const evaluator: ContentGuardrailEvaluator = {
      evaluateContent: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    const handler = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const wrapped = guardrailWrap(handler, {
      toolName: 'test', getAgentId: () => 'a1', getTenantId: () => 'default', evaluator,
    });
    const result = await wrapped({});
    expect(handler).toHaveBeenCalled();
    expect(result.content[0].text).toBe('ok');
  });
});
