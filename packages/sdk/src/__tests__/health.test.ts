/**
 * Tests for AgentLensClient health + optimization methods (Stories 3.1)
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentLensClient } from '../client.js';

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

const sampleHealthScore = {
  agentId: 'agent-1',
  overallScore: 82,
  trend: 'improving' as const,
  trendDelta: 3.5,
  dimensions: [
    { name: 'error_rate', score: 90, weight: 0.3, rawValue: 0.02, description: 'Low error rate' },
    { name: 'cost_efficiency', score: 75, weight: 0.2, rawValue: 0.005, description: 'Average cost' },
  ],
  window: { from: '2026-02-01T00:00:00Z', to: '2026-02-08T00:00:00Z' },
  sessionCount: 42,
  computedAt: '2026-02-08T12:00:00Z',
};

const sampleSnapshot = {
  agentId: 'agent-1',
  date: '2026-02-07',
  overallScore: 80,
  errorRateScore: 88,
  costEfficiencyScore: 72,
  toolSuccessScore: 85,
  latencyScore: 78,
  completionRateScore: 90,
  sessionCount: 10,
};

const sampleOptimizationResult = {
  recommendations: [
    {
      currentModel: 'claude-opus-4-6',
      recommendedModel: 'claude-sonnet-4-20250514',
      complexityTier: 'simple' as const,
      currentCostPerCall: 0.03,
      recommendedCostPerCall: 0.003,
      monthlySavings: 54.0,
      callVolume: 2000,
      currentSuccessRate: 0.98,
      recommendedSuccessRate: 0.97,
      confidence: 'high' as const,
      agentId: 'agent-1',
    },
  ],
  totalPotentialSavings: 54.0,
  period: 30,
  analyzedCalls: 2000,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentLensClient.getHealth', () => {
  it('calls correct URL for agent health', async () => {
    const fn = mockFetch(200, sampleHealthScore);
    const client = createClient(fn);

    await client.getHealth('agent-1');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/agents/agent-1/health');
  });

  it('appends window query param when provided', async () => {
    const fn = mockFetch(200, sampleHealthScore);
    const client = createClient(fn);

    await client.getHealth('agent-1', 7);

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/agents/agent-1/health?window=7');
  });

  it('returns typed HealthScore', async () => {
    const fn = mockFetch(200, sampleHealthScore);
    const client = createClient(fn);

    const result = await client.getHealth('agent-1');
    expect(result.agentId).toBe('agent-1');
    expect(result.overallScore).toBe(82);
    expect(result.trend).toBe('improving');
    expect(result.dimensions).toHaveLength(2);
  });

  it('encodes special characters in agentId', async () => {
    const fn = mockFetch(200, sampleHealthScore);
    const client = createClient(fn);

    await client.getHealth('agent/special id');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/agents/agent%2Fspecial%20id/health');
  });
});

describe('AgentLensClient.getHealthOverview', () => {
  it('calls correct URL without params', async () => {
    const fn = mockFetch(200, [sampleHealthScore]);
    const client = createClient(fn);

    await client.getHealthOverview();

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/health/overview');
  });

  it('appends window param', async () => {
    const fn = mockFetch(200, [sampleHealthScore]);
    const client = createClient(fn);

    await client.getHealthOverview(14);

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/health/overview?window=14');
  });

  it('returns array of HealthScore', async () => {
    const fn = mockFetch(200, [sampleHealthScore, { ...sampleHealthScore, agentId: 'agent-2' }]);
    const client = createClient(fn);

    const result = await client.getHealthOverview();
    expect(result).toHaveLength(2);
    expect(result[0]!.agentId).toBe('agent-1');
    expect(result[1]!.agentId).toBe('agent-2');
  });
});

describe('AgentLensClient.getHealthHistory', () => {
  it('calls correct URL with agentId', async () => {
    const fn = mockFetch(200, [sampleSnapshot]);
    const client = createClient(fn);

    await client.getHealthHistory('agent-1');

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('/api/health/history?agentId=agent-1');
  });

  it('appends days param when provided', async () => {
    const fn = mockFetch(200, [sampleSnapshot]);
    const client = createClient(fn);

    await client.getHealthHistory('agent-1', 30);

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('days=30');
  });

  it('returns array of HealthSnapshot', async () => {
    const fn = mockFetch(200, [sampleSnapshot, { ...sampleSnapshot, date: '2026-02-06', overallScore: 78 }]);
    const client = createClient(fn);

    const result = await client.getHealthHistory('agent-1');
    expect(result).toHaveLength(2);
    expect(result[0]!.overallScore).toBe(80);
    expect(result[1]!.date).toBe('2026-02-06');
  });
});

describe('AgentLensClient.getOptimizationRecommendations', () => {
  it('calls correct URL without params', async () => {
    const fn = mockFetch(200, sampleOptimizationResult);
    const client = createClient(fn);

    await client.getOptimizationRecommendations();

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toBe('http://localhost:3400/api/optimize/recommendations');
  });

  it('appends all optional params', async () => {
    const fn = mockFetch(200, sampleOptimizationResult);
    const client = createClient(fn);

    await client.getOptimizationRecommendations({
      agentId: 'agent-1',
      period: 30,
      limit: 5,
    });

    const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('agentId=agent-1');
    expect(url).toContain('period=30');
    expect(url).toContain('limit=5');
  });

  it('returns typed OptimizationResult', async () => {
    const fn = mockFetch(200, sampleOptimizationResult);
    const client = createClient(fn);

    const result = await client.getOptimizationRecommendations();
    expect(result.totalPotentialSavings).toBe(54.0);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]!.recommendedModel).toBe('claude-sonnet-4-20250514');
    expect(result.analyzedCalls).toBe(2000);
  });

  it('sends Authorization header', async () => {
    const fn = mockFetch(200, sampleOptimizationResult);
    const client = createClient(fn);

    await client.getOptimizationRecommendations();

    const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
  });
});
