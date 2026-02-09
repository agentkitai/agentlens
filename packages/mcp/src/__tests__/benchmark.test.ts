/**
 * Tests for agentlens_benchmark MCP tool (Stories 4.2, 4.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { AgentLensTransport } from '../transport.js';
import {
  formatBenchmarkList,
  formatBenchmarkCreated,
  formatBenchmarkStatus,
  formatBenchmarkResults,
  type BenchmarkSummary,
  type BenchmarkDetail,
  type BenchmarkResults,
} from '../tools/benchmark.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(data: unknown = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

const MOCK_BENCHMARK_DETAIL: BenchmarkDetail = {
  id: 'bench_001',
  name: 'GPT-4o vs Claude',
  status: 'draft',
  description: 'Compare models on coding tasks',
  variants: [
    { name: 'gpt-4o', tag: 'v-gpt4o', description: 'OpenAI GPT-4o', sessionCount: 0 },
    { name: 'claude-3.5', tag: 'v-claude', description: 'Anthropic Claude 3.5', sessionCount: 0 },
  ],
  metrics: ['cost', 'latency', 'success_rate'],
  minSessions: 20,
  agentId: 'test-agent',
  createdAt: '2026-02-08T10:00:00.000Z',
};

const MOCK_BENCHMARK_RUNNING: BenchmarkDetail = {
  ...MOCK_BENCHMARK_DETAIL,
  status: 'running',
  startedAt: '2026-02-08T11:00:00.000Z',
  variants: [
    { name: 'gpt-4o', tag: 'v-gpt4o', sessionCount: 15 },
    { name: 'claude-3.5', tag: 'v-claude', sessionCount: 18 },
  ],
};

const MOCK_BENCHMARK_LIST: BenchmarkSummary[] = [
  {
    id: 'bench_001',
    name: 'GPT-4o vs Claude',
    status: 'running',
    variants: [
      { name: 'gpt-4o', tag: 'v-gpt4o' },
      { name: 'claude-3.5', tag: 'v-claude' },
    ],
    createdAt: '2026-02-08T10:00:00.000Z',
  },
  {
    id: 'bench_002',
    name: 'Temperature Sweep',
    status: 'completed',
    variants: [
      { name: 'temp-0.0', tag: 'v-t0' },
      { name: 'temp-0.7', tag: 'v-t7' },
      { name: 'temp-1.0', tag: 'v-t10' },
    ],
    createdAt: '2026-02-07T10:00:00.000Z',
    description: 'Comparing temperature settings',
  },
];

const MOCK_RESULTS: BenchmarkResults = {
  benchmarkId: 'bench_001',
  name: 'GPT-4o vs Claude',
  status: 'completed',
  metrics: [
    {
      metric: 'cost',
      variants: [
        { name: 'gpt-4o', mean: 0.0045, stddev: 0.001, n: 20 },
        { name: 'claude-3.5', mean: 0.0032, stddev: 0.0008, n: 20 },
      ],
      pValue: 0.003,
      significant: true,
      winner: 'claude-3.5',
      difference: -0.0013,
      differencePercent: -28.9,
    },
    {
      metric: 'latency',
      variants: [
        { name: 'gpt-4o', mean: 1200, stddev: 300, n: 20 },
        { name: 'claude-3.5', mean: 1150, stddev: 280, n: 20 },
      ],
      pValue: 0.42,
      significant: false,
    },
    {
      metric: 'success_rate',
      variants: [
        { name: 'gpt-4o', mean: 0.92, stddev: 0.05, n: 20 },
        { name: 'claude-3.5', mean: 0.95, stddev: 0.03, n: 20 },
      ],
      pValue: 0.02,
      significant: true,
      winner: 'claude-3.5',
      difference: 0.03,
      differencePercent: 3.3,
    },
  ],
  summary: 'Claude 3.5 wins on cost (p<0.01) and success rate (p<0.05). No significant difference in latency.',
};

async function createTestSetup() {
  const transport = new AgentLensTransport({
    baseUrl: 'http://localhost:3400',
    apiKey: 'test-key',
  });

  const server = new McpServer(
    { name: 'agentlens-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );

  registerTools(server, transport);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { server, client, transport };
}

describe('agentlens_benchmark', () => {
  it('tool is registered with correct schema', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_benchmark');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('benchmark');

    const schema = tool!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toHaveProperty('action');
    expect(schema.properties).toHaveProperty('name');
    expect(schema.properties).toHaveProperty('variants');
    expect(schema.properties).toHaveProperty('benchmarkId');
    expect(schema.required).toContain('action');
  });

  it('total tool count is 14', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(17);
  });

  // ─── Create ───────────────────────────────────────────────

  it('creates a benchmark successfully', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_BENCHMARK_DETAIL));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: {
        action: 'create',
        name: 'GPT-4o vs Claude',
        description: 'Compare models on coding tasks',
        variants: [
          { name: 'gpt-4o', tag: 'v-gpt4o' },
          { name: 'claude-3.5', tag: 'v-claude' },
        ],
        metrics: ['cost', 'latency', 'success_rate'],
        minSessions: 20,
      },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    expect(text).toContain('✅ Benchmark created');
    expect(text).toContain('GPT-4o vs Claude');
    expect(text).toContain('bench_001');
    expect(text).toContain('Next steps');
  });

  it('validates: name required for create', async () => {
    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: {
        action: 'create',
        variants: [
          { name: 'a', tag: 'ta' },
          { name: 'b', tag: 'tb' },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('name');
  });

  it('validates: at least 2 variants required', async () => {
    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: {
        action: 'create',
        name: 'Test',
        variants: [{ name: 'only-one', tag: 'v1' }],
      },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('2 variants');
  });

  // ─── List ─────────────────────────────────────────────────

  it('lists benchmarks', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ benchmarks: MOCK_BENCHMARK_LIST }));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'list' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    expect(text).toContain('Benchmarks (2)');
    expect(text).toContain('GPT-4o vs Claude');
    expect(text).toContain('Temperature Sweep');
  });

  it('lists benchmarks with status filter', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ benchmarks: [MOCK_BENCHMARK_LIST[0]] }));

    const { client } = await createTestSetup();
    await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'list', status: 'running' },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('status=running');
  });

  // ─── Status ───────────────────────────────────────────────

  it('gets benchmark status with session counts', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_BENCHMARK_RUNNING));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'status', benchmarkId: 'bench_001' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    expect(text).toContain('🏃 Benchmark: GPT-4o vs Claude [running]');
    expect(text).toContain('15/20');
    expect(text).toContain('18/20');
  });

  it('validates: benchmarkId required for status', async () => {
    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'status' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('benchmarkId');
  });

  // ─── Results ──────────────────────────────────────────────

  it('gets benchmark results as formatted table', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_RESULTS));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'results', benchmarkId: 'bench_001' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    expect(text).toContain('Benchmark Results');
    expect(text).toContain('cost');
    expect(text).toContain('latency');
    expect(text).toContain('success_rate');
    expect(text).toContain('claude-3.5 wins');
    expect(text).toContain('no sig. diff.');
    expect(text).toContain('★★');
    expect(text).toContain('p<0.05');
  });

  // ─── Start ────────────────────────────────────────────────

  it('starts a benchmark', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({ ...MOCK_BENCHMARK_DETAIL, status: 'running', name: 'GPT-4o vs Claude' }),
    );

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'start', benchmarkId: 'bench_001' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('🏃 Benchmark "GPT-4o vs Claude" is now running');

    // Verify correct API call
    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('/api/benchmarks/bench_001/status');
    const fetchOpts = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(fetchOpts.body as string)).toEqual({ status: 'running' });
  });

  // ─── Complete ─────────────────────────────────────────────

  it('completes a benchmark', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        ...MOCK_BENCHMARK_DETAIL,
        status: 'completed',
        name: 'GPT-4o vs Claude',
        results: MOCK_RESULTS,
      }),
    );

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'complete', benchmarkId: 'bench_001' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;
    expect(text).toContain('✅ Benchmark "GPT-4o vs Claude" is now completed');
    expect(text).toContain('Benchmark Results');
  });

  // ─── Error Handling ───────────────────────────────────────

  it('handles 404 error for invalid benchmark', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, '{"error":"Not found"}'));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'status', benchmarkId: 'nonexistent' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Benchmark not found');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_benchmark',
      arguments: { action: 'list' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });
});

describe('formatBenchmarkList', () => {
  it('formats empty list', () => {
    expect(formatBenchmarkList([])).toBe('No benchmarks found.');
  });

  it('formats list with status icons and variant names', () => {
    const text = formatBenchmarkList(MOCK_BENCHMARK_LIST);
    expect(text).toContain('📊 Benchmarks (2)');
    expect(text).toContain('🏃 GPT-4o vs Claude [running]');
    expect(text).toContain('✅ Temperature Sweep [completed]');
    expect(text).toContain('gpt-4o vs claude-3.5');
    expect(text).toContain('temp-0.0 vs temp-0.7 vs temp-1.0');
    expect(text).toContain('Comparing temperature settings');
  });
});

describe('formatBenchmarkResults', () => {
  it('formats results as ASCII table with confidence stars', () => {
    const text = formatBenchmarkResults(MOCK_RESULTS);
    expect(text).toContain('Benchmark Results: GPT-4o vs Claude');
    expect(text).toContain('cost');
    expect(text).toContain('latency');
    expect(text).toContain('success_rate');
    expect(text).toContain('claude-3.5 wins');
    expect(text).toContain('no sig. diff.');
    // p=0.003 → ★★
    expect(text).toContain('★★');
    // p=0.02 → ★
    expect(text).toContain('★');
    expect(text).toContain('Confidence:');
    expect(text).toContain('Summary:');
  });

  it('formats empty results', () => {
    const empty: BenchmarkResults = {
      benchmarkId: 'bench_001',
      name: 'Test',
      status: 'running',
      metrics: [],
      summary: '',
    };
    const text = formatBenchmarkResults(empty);
    expect(text).toContain('No results available yet');
  });
});

describe('formatBenchmarkStatus', () => {
  it('formats status with session progress', () => {
    const text = formatBenchmarkStatus(MOCK_BENCHMARK_RUNNING);
    expect(text).toContain('🏃 Benchmark: GPT-4o vs Claude [running]');
    expect(text).toContain('gpt-4o [v-gpt4o]');
    expect(text).toContain('15/20');
    expect(text).toContain('claude-3.5 [v-claude]');
    expect(text).toContain('18/20');
    expect(text).toContain('Metrics: cost, latency, success_rate');
  });
});
