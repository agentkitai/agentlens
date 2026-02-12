/**
 * Tests for agentlens_optimize MCP tool (Story 2.5)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { AgentLensTransport } from '../transport.js';

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

describe('agentlens_optimize', () => {
  it('is registered with correct schema', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_optimize');

    expect(tool).toBeDefined();
    expect(tool!.description).toContain('cost optimization');
    expect(tool!.inputSchema.properties).toHaveProperty('period');
    expect(tool!.inputSchema.properties).toHaveProperty('limit');
  });

  it('registers 14 tools total (11 existing + guardrails)', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    expect(result.tools).toHaveLength(15);

    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('agentlens_optimize');
  });

  it('formats output with recommendations', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [
          {
            currentModel: 'gpt-4o',
            recommendedModel: 'gpt-4o-mini',
            complexityTier: 'simple',
            currentCostPerCall: 0.05,
            recommendedCostPerCall: 0.001,
            monthlySavings: 89.2,
            callVolume: 312,
            currentSuccessRate: 0.99,
            recommendedSuccessRate: 0.98,
            confidence: 'high',
            agentId: 'my-agent',
          },
          {
            currentModel: 'claude-opus-4',
            recommendedModel: 'claude-sonnet-4',
            complexityTier: 'moderate',
            currentCostPerCall: 0.10,
            recommendedCostPerCall: 0.02,
            monthlySavings: 53.3,
            callVolume: 87,
            currentSuccessRate: 0.97,
            recommendedSuccessRate: 0.96,
            confidence: 'medium',
            agentId: 'my-agent',
          },
        ],
        totalPotentialSavings: 142.5,
        period: 7,
        analyzedCalls: 1247,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_optimize',
      arguments: { period: 7 },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    expect(text).toContain('💰 Cost Optimization Recommendations');
    expect(text).toContain('$142.50/month');
    expect(text).toContain('1,247 calls');
    expect(text).toContain('gpt-4o → gpt-4o-mini');
    expect(text).toContain('SIMPLE');
    expect(text).toContain('$89.20/month');
    expect(text).toContain('HIGH');
    expect(text).toContain('claude-opus-4 → claude-sonnet-4');
    expect(text).toContain('MODERATE');
  });

  it('shows optimized message when no recommendations', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [],
        totalPotentialSavings: 0,
        period: 7,
        analyzedCalls: 500,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('already optimized');
    expect(content[0]!.text).toContain('🎉');
  });

  it('shows no-data message when zero calls analyzed', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [],
        totalPotentialSavings: 0,
        period: 7,
        analyzedCalls: 0,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('No LLM call data found');
  });

  it('uses default params when none provided', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [],
        totalPotentialSavings: 0,
        period: 7,
        analyzedCalls: 0,
      }),
    );

    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    // Verify the fetch URL uses defaults
    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('period=7');
    expect(fetchUrl).toContain('limit=5');
  });

  it('passes custom params to the API', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [],
        totalPotentialSavings: 0,
        period: 30,
        analyzedCalls: 0,
      }),
    );

    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_optimize',
      arguments: { period: 30, limit: 20 },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('period=30');
    expect(fetchUrl).toContain('limit=20');
    expect(fetchUrl).toContain('/api/optimize/recommendations');
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, 'Internal Server Error'),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Error getting optimization recommendations');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });

  it('includes auth header in API call', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        recommendations: [],
        totalPotentialSavings: 0,
        period: 7,
        analyzedCalls: 0,
      }),
    );

    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_optimize',
      arguments: {},
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
  });
});
