/**
 * Tests for agentlens_health MCP tool (Story 1.5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { AgentLensTransport } from '../transport.js';
import { formatHealthScore } from '../tools/health.js';

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

const MOCK_HEALTH_SCORE = {
  agentId: 'test-agent',
  overallScore: 82,
  trend: 'improving' as const,
  trendDelta: 7,
  dimensions: [
    { name: 'error_rate', score: 90, weight: 0.30, rawValue: 0.1, description: '1/10 sessions had errors' },
    { name: 'cost_efficiency', score: 75, weight: 0.20, rawValue: 0.005, description: 'Avg cost per session: $0.0050' },
    { name: 'tool_success', score: 85, weight: 0.20, rawValue: 0.85, description: '17/20 tool calls succeeded' },
    { name: 'latency', score: 78, weight: 0.15, rawValue: 1200, description: 'Avg session duration: 1200ms' },
    { name: 'completion_rate', score: 80, weight: 0.15, rawValue: 0.8, description: '8/10 sessions completed' },
  ],
  window: { from: '2026-02-01T00:00:00.000Z', to: '2026-02-08T00:00:00.000Z' },
  sessionCount: 42,
  computedAt: '2026-02-08T12:00:00.000Z',
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

describe('agentlens_health', () => {
  it('tool is registered with correct schema', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_health');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('health score');

    // Check inputSchema has window property
    const schema = tool!.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties).toHaveProperty('window');
  });

  it('total tool count is 14', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(23);
  });

  it('returns formatted output with score, trend, and dimensions', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_HEALTH_SCORE));

    const { client, transport } = await createTestSetup();

    // Set up an active session so the tool has an agentId
    transport.setSessionAgent('ses_test', 'test-agent');

    const result = await client.callTool({
      name: 'agentlens_health',
      arguments: { window: 7 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    expect(text).toContain('Health Score: 82/100');
    expect(text).toContain('improving');
    expect(text).toContain('+7pts');
    expect(text).toContain('Error Rate:');
    expect(text).toContain('Cost Efficiency:');
    expect(text).toContain('Tool Success:');
    expect(text).toContain('Latency:');
    expect(text).toContain('Completion Rate:');
    expect(text).toContain('42 sessions');
  });

  it('handles no sessions (404 from API)', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(404, JSON.stringify({ error: 'No sessions found for agent in window' })),
    );

    const { client, transport } = await createTestSetup();
    transport.setSessionAgent('ses_test', 'test-agent');

    const result = await client.callTool({
      name: 'agentlens_health',
      arguments: {},
    });

    // Should not be isError — just informational
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('No sessions found');
  });

  it('uses default window of 7', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_HEALTH_SCORE));

    const { client, transport } = await createTestSetup();
    transport.setSessionAgent('ses_test', 'test-agent');

    await client.callTool({
      name: 'agentlens_health',
      arguments: {},
    });

    // Verify fetch was called with window=7
    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('window=7');
  });

  it('passes custom window parameter', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_HEALTH_SCORE));

    const { client, transport } = await createTestSetup();
    transport.setSessionAgent('ses_test', 'test-agent');

    await client.callTool({
      name: 'agentlens_health',
      arguments: { window: 30 },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('window=30');
  });

  it('returns error when no active session', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_health',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('No active session');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client, transport } = await createTestSetup();
    transport.setSessionAgent('ses_test', 'test-agent');

    const result = await client.callTool({
      name: 'agentlens_health',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });
});

describe('formatHealthScore', () => {
  it('formats health score as readable text', () => {
    const text = formatHealthScore(MOCK_HEALTH_SCORE);

    expect(text).toContain('Health Score: 82/100');
    expect(text).toContain('↑ improving');
    expect(text).toContain('+7pts');
    expect(text).toContain('Dimensions:');
    expect(text).toContain('Error Rate:');
    expect(text).toContain('90/100 (weight: 0.30)');
    expect(text).toContain('Window: 2026-02-01 to 2026-02-08 (42 sessions)');
  });

  it('formats degrading trend correctly', () => {
    const degrading = {
      ...MOCK_HEALTH_SCORE,
      trend: 'degrading' as const,
      trendDelta: -10,
    };
    const text = formatHealthScore(degrading);
    expect(text).toContain('↓ degrading');
    expect(text).toContain('-10pts');
  });
});
