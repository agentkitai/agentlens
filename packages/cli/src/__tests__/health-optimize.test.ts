/**
 * Tests for CLI health + optimize commands (Story 3.3)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock SDK client ────────────────────────────────────────────────

const mockGetHealth = vi.fn();
const mockGetHealthOverview = vi.fn();
const mockGetHealthHistory = vi.fn();
const mockGetOptimizationRecommendations = vi.fn();

vi.mock('@agentlensai/sdk', () => ({
  AgentLensClient: vi.fn().mockImplementation(() => ({
    getHealth: mockGetHealth,
    getHealthOverview: mockGetHealthOverview,
    getHealthHistory: mockGetHealthHistory,
    getOptimizationRecommendations: mockGetOptimizationRecommendations,
  })),
}));

vi.mock('../lib/config.js', () => ({
  loadConfig: () => ({ url: 'http://localhost:3400', apiKey: 'test' }),
}));

// ─── Helpers ────────────────────────────────────────────────────────

let consoleOutput: string[];
let originalLog: typeof console.log;
let originalError: typeof console.error;

beforeEach(() => {
  consoleOutput = [];
  originalLog = console.log;
  originalError = console.error;
  console.log = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  console.error = (...args: unknown[]) => consoleOutput.push(args.join(' '));
  vi.clearAllMocks();
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
});

// ─── Sample data ────────────────────────────────────────────────────

const sampleHealthScore = {
  agentId: 'agent-1',
  overallScore: 82,
  trend: 'improving',
  trendDelta: 3.5,
  dimensions: [
    { name: 'error_rate', score: 90, weight: 0.3, rawValue: 0.02, description: 'Low error rate' },
    { name: 'cost_efficiency', score: 75, weight: 0.2, rawValue: 0.005, description: 'Avg cost' },
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

const sampleOptResult = {
  recommendations: [
    {
      currentModel: 'claude-opus-4-6',
      recommendedModel: 'claude-sonnet-4-20250514',
      complexityTier: 'simple',
      currentCostPerCall: 0.03,
      recommendedCostPerCall: 0.003,
      monthlySavings: 54.0,
      callVolume: 2000,
      currentSuccessRate: 0.98,
      recommendedSuccessRate: 0.97,
      confidence: 'high',
      agentId: 'agent-1',
    },
  ],
  totalPotentialSavings: 54.0,
  period: 30,
  analyzedCalls: 2000,
};

// ─── Tests ──────────────────────────────────────────────────────────

describe('health command', () => {
  it('shows help with --help flag', async () => {
    const { runHealthCommand } = await import('../commands/health.js');
    await runHealthCommand(['--help']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Usage: agentlens health');
    expect(output).toContain('--agent');
    expect(output).toContain('--history');
  });

  it('displays health overview table', async () => {
    mockGetHealthOverview.mockResolvedValue([sampleHealthScore]);
    const { runHealthCommand } = await import('../commands/health.js');

    await runHealthCommand([]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Agent Health Overview');
    expect(output).toContain('agent-1');
    expect(mockGetHealthOverview).toHaveBeenCalledWith(undefined);
  });

  it('displays detailed single agent health', async () => {
    mockGetHealth.mockResolvedValue(sampleHealthScore);
    const { runHealthCommand } = await import('../commands/health.js');

    await runHealthCommand(['--agent', 'agent-1']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Agent Health');
    expect(output).toContain('agent-1');
    expect(output).toContain('error_rate');
    expect(mockGetHealth).toHaveBeenCalledWith('agent-1', undefined);
  });

  it('displays health history with --agent and --history', async () => {
    mockGetHealthHistory.mockResolvedValue([sampleSnapshot]);
    const { runHealthCommand } = await import('../commands/health.js');

    await runHealthCommand(['--agent', 'agent-1', '--history']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Health History');
    expect(output).toContain('2026-02-07');
    expect(mockGetHealthHistory).toHaveBeenCalledWith('agent-1', 30);
  });

  it('outputs JSON when --format json', async () => {
    mockGetHealthOverview.mockResolvedValue([sampleHealthScore]);
    const { runHealthCommand } = await import('../commands/health.js');

    await runHealthCommand(['--format', 'json']);

    const output = consoleOutput.join('\n');
    // Should be valid JSON
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].agentId).toBe('agent-1');
  });

  it('passes window parameter through', async () => {
    mockGetHealthOverview.mockResolvedValue([]);
    const { runHealthCommand } = await import('../commands/health.js');

    await runHealthCommand(['--window', '14']);

    expect(mockGetHealthOverview).toHaveBeenCalledWith(14);
  });
});

describe('optimize command', () => {
  it('shows help with --help flag', async () => {
    const { runOptimizeCommand } = await import('../commands/optimize.js');
    await runOptimizeCommand(['--help']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Usage: agentlens optimize');
    expect(output).toContain('--agent');
  });

  it('displays recommendations table', async () => {
    mockGetOptimizationRecommendations.mockResolvedValue(sampleOptResult);
    const { runOptimizeCommand } = await import('../commands/optimize.js');

    await runOptimizeCommand([]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Optimization Recommendations');
    expect(output).toContain('$54.00');
    expect(output).toContain('agent-1');
    expect(mockGetOptimizationRecommendations).toHaveBeenCalledWith({
      agentId: undefined,
      period: undefined,
      limit: undefined,
    });
  });

  it('passes agent filter to SDK', async () => {
    mockGetOptimizationRecommendations.mockResolvedValue({ ...sampleOptResult, recommendations: [] });
    const { runOptimizeCommand } = await import('../commands/optimize.js');

    await runOptimizeCommand(['--agent', 'agent-1']);

    expect(mockGetOptimizationRecommendations).toHaveBeenCalledWith({
      agentId: 'agent-1',
      period: undefined,
      limit: undefined,
    });
  });

  it('outputs JSON when --format json', async () => {
    mockGetOptimizationRecommendations.mockResolvedValue(sampleOptResult);
    const { runOptimizeCommand } = await import('../commands/optimize.js');

    await runOptimizeCommand(['--format', 'json']);

    const output = consoleOutput.join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.totalPotentialSavings).toBe(54.0);
    expect(parsed.recommendations).toHaveLength(1);
  });
});
