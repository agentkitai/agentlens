/**
 * Tests for agentlens_reflect MCP tool (Story 4.5)
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

describe('agentlens_reflect', () => {
  it('calls the reflect API with correct parameters', async () => {
    const reflectResult = {
      analysis: 'error_patterns',
      insights: [
        {
          type: 'error_pattern',
          summary: 'Connection timeout occurred 5 times',
          data: { pattern: 'Connection timeout', count: 5 },
          confidence: 0.9,
        },
      ],
      metadata: {
        sessionsAnalyzed: 10,
        eventsAnalyzed: 50,
        timeRange: { from: '2024-01-01', to: '2024-01-31' },
      },
    };

    mockFetch.mockResolvedValueOnce(okResponse(reflectResult));

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: {
        analysis: 'error_patterns',
        agentId: 'my-agent',
        from: '2024-01-01',
        to: '2024-01-31',
        limit: 10,
      },
    });

    // Verify the fetch was called with the right URL
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/reflect?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('analysis=error_patterns');
    expect(fetchUrl).toContain('agentId=my-agent');
    expect(fetchUrl).toContain('from=2024-01-01');
    expect(fetchUrl).toContain('to=2024-01-31');
    expect(fetchUrl).toContain('limit=10');

    // Verify the result contains the data
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text);
    expect(parsed.analysis).toBe('error_patterns');
    expect(parsed.insights).toHaveLength(1);
  });

  it('handles error_patterns analysis', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        analysis: 'error_patterns',
        insights: [],
        metadata: { sessionsAnalyzed: 0, eventsAnalyzed: 0, timeRange: { from: '', to: '' } },
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'error_patterns' },
    });

    expect(result.isError).toBeUndefined();
  });

  it('handles tool_sequences analysis', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        analysis: 'tool_sequences',
        insights: [],
        metadata: { sessionsAnalyzed: 0, eventsAnalyzed: 0, timeRange: { from: '', to: '' } },
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'tool_sequences' },
    });

    expect(result.isError).toBeUndefined();
  });

  it('handles cost_analysis analysis', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        analysis: 'cost_analysis',
        insights: [],
        metadata: { sessionsAnalyzed: 0, eventsAnalyzed: 0, timeRange: { from: '', to: '' } },
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'cost_analysis' },
    });

    expect(result.isError).toBeUndefined();
  });

  it('handles performance_trends analysis', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        analysis: 'performance_trends',
        insights: [],
        metadata: { sessionsAnalyzed: 0, eventsAnalyzed: 0, timeRange: { from: '', to: '' } },
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'performance_trends' },
    });

    expect(result.isError).toBeUndefined();
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, 'Internal Server Error'),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'error_patterns' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Error running error_patterns analysis');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_reflect',
      arguments: { analysis: 'error_patterns' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });
});
