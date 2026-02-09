/**
 * Tests for AgentLensClient guardrail methods (Story 4.1 / 4.4)
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentLensClient } from '../client.js';
import { AuthenticationError, NotFoundError, ValidationError } from '../errors.js';

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'als_test123',
    fetch: fetchFn,
  });
}

// ─── Sample data ────────────────────────────────────────────────────

const sampleRule = {
  id: 'rule_001',
  tenantId: 'default',
  name: 'High Error Rate',
  description: 'Pause agent on high errors',
  enabled: true,
  conditionType: 'error_rate_threshold',
  conditionConfig: { threshold: 50, windowMinutes: 15 },
  actionType: 'pause_agent',
  actionConfig: { reason: 'Error rate exceeded' },
  agentId: 'agent-1',
  cooldownMinutes: 10,
  dryRun: false,
  createdAt: '2026-02-08T10:00:00Z',
  updatedAt: '2026-02-08T10:00:00Z',
};

const sampleState = {
  ruleId: 'rule_001',
  tenantId: 'default',
  lastTriggeredAt: '2026-02-08T11:00:00Z',
  triggerCount: 3,
  lastEvaluatedAt: '2026-02-08T12:00:00Z',
  currentValue: 55.0,
};

const sampleTrigger = {
  id: 'trig_001',
  ruleId: 'rule_001',
  tenantId: 'default',
  triggeredAt: '2026-02-08T11:00:00Z',
  conditionValue: 55.0,
  conditionThreshold: 50.0,
  actionExecuted: true,
  actionResult: 'Agent paused',
  metadata: { sessionId: 'sess_001' },
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentLensClient.listGuardrails', () => {
  it('calls correct URL without params', async () => {
    const fn = mockFetch(200, { rules: [sampleRule] });
    const client = createClient(fn);

    const result = await client.listGuardrails();

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails');
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.name).toBe('High Error Rate');
  });

  it('passes agentId filter', async () => {
    const fn = mockFetch(200, { rules: [] });
    const client = createClient(fn);

    await client.listGuardrails({ agentId: 'agent-1' });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('agentId=agent-1');
  });
});

describe('AgentLensClient.getGuardrail', () => {
  it('calls correct URL and returns rule', async () => {
    const fn = mockFetch(200, sampleRule);
    const client = createClient(fn);

    const result = await client.getGuardrail('rule_001');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails/rule_001');
    expect(result.id).toBe('rule_001');
    expect(result.conditionType).toBe('error_rate_threshold');
  });
});

describe('AgentLensClient.createGuardrail', () => {
  it('sends POST with body and returns rule', async () => {
    const fn = mockFetch(200, sampleRule);
    const client = createClient(fn);

    const result = await client.createGuardrail({
      name: 'High Error Rate',
      conditionType: 'error_rate_threshold',
      conditionConfig: { threshold: 50 },
      actionType: 'pause_agent',
      actionConfig: { reason: 'Error rate exceeded' },
      agentId: 'agent-1',
      enabled: true,
      dryRun: false,
      cooldownMinutes: 10,
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails');
    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.name).toBe('High Error Rate');
    expect(body.conditionType).toBe('error_rate_threshold');
    expect(result.name).toBe('High Error Rate');
  });
});

describe('AgentLensClient.updateGuardrail', () => {
  it('sends PUT with updates', async () => {
    const fn = mockFetch(200, { ...sampleRule, name: 'Updated' });
    const client = createClient(fn);

    const result = await client.updateGuardrail('rule_001', { name: 'Updated', dryRun: true });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails/rule_001');
    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect(body.name).toBe('Updated');
    expect(body.dryRun).toBe(true);
    expect(result.name).toBe('Updated');
  });
});

describe('AgentLensClient.deleteGuardrail', () => {
  it('sends DELETE and returns ok', async () => {
    const fn = mockFetch(200, { ok: true });
    const client = createClient(fn);

    const result = await client.deleteGuardrail('rule_001');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails/rule_001');
    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('DELETE');
    expect(result.ok).toBe(true);
  });
});

describe('AgentLensClient.enableGuardrail / disableGuardrail', () => {
  it('enableGuardrail sends enabled=true via PUT', async () => {
    const fn = mockFetch(200, { ...sampleRule, enabled: true });
    const client = createClient(fn);

    const result = await client.enableGuardrail('rule_001');

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(opts.method).toBe('PUT');
    const body = JSON.parse(opts.body as string);
    expect(body.enabled).toBe(true);
    expect(result.enabled).toBe(true);
  });

  it('disableGuardrail sends enabled=false via PUT', async () => {
    const fn = mockFetch(200, { ...sampleRule, enabled: false });
    const client = createClient(fn);

    const result = await client.disableGuardrail('rule_001');

    const body = JSON.parse(((fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit).body as string);
    expect(body.enabled).toBe(false);
    expect(result.enabled).toBe(false);
  });
});

describe('AgentLensClient.getGuardrailHistory', () => {
  it('calls correct URL with params', async () => {
    const fn = mockFetch(200, { triggers: [sampleTrigger], total: 1 });
    const client = createClient(fn);

    const result = await client.getGuardrailHistory({ ruleId: 'rule_001', limit: 10 });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/guardrails/history');
    expect(url).toContain('ruleId=rule_001');
    expect(url).toContain('limit=10');
    expect(result.triggers).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('AgentLensClient.getGuardrailStatus', () => {
  it('returns rule, state, and recent triggers', async () => {
    const fn = mockFetch(200, {
      rule: sampleRule,
      state: sampleState,
      recentTriggers: [sampleTrigger],
    });
    const client = createClient(fn);

    const result = await client.getGuardrailStatus('rule_001');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/guardrails/rule_001/status');
    expect(result.rule.id).toBe('rule_001');
    expect(result.state!.triggerCount).toBe(3);
    expect(result.recentTriggers).toHaveLength(1);
  });
});

// ─── Error-path tests ───────────────────────────────────────────────

describe('AgentLensClient guardrail error paths', () => {
  it('throws AuthenticationError on 401', async () => {
    const fn = mockFetch(401, { error: 'Unauthorized' });
    const client = createClient(fn);

    await expect(client.listGuardrails()).rejects.toThrow(AuthenticationError);
  });

  it('throws NotFoundError on 404 for getGuardrail', async () => {
    const fn = mockFetch(404, { error: 'Guardrail rule not found' });
    const client = createClient(fn);

    await expect(client.getGuardrail('nonexistent')).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError on 400 for createGuardrail', async () => {
    const fn = mockFetch(400, { error: 'Validation failed', details: [{ path: 'name', message: 'Required' }] });
    const client = createClient(fn);

    await expect(
      client.createGuardrail({
        name: '',
        conditionType: 'error_rate_threshold',
        conditionConfig: {},
        actionType: 'pause_agent',
        actionConfig: {},
      }),
    ).rejects.toThrow(ValidationError);
  });
});
