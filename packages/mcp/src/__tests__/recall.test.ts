/**
 * Tests for agentlens_recall MCP tool (Story 2.5)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { AgentLensTransport } from '../transport.js';

// Mock global fetch
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

describe('agentlens_recall registration', () => {
  it('registers the tool', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('agentlens_recall');
  });

  it('registers 9 tools total', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(9);
  });

  it('has a description mentioning semantic search', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_recall');
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description!.toLowerCase()).toContain('semantic');
  });

  it('has query as required field', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_recall');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('query');
  });
});

describe('agentlens_recall results', () => {
  it('returns formatted results', async () => {
    const data = {
      results: [
        { sourceType: 'event', sourceId: 'ev-1', score: 0.92, text: 'tool_error: readFile - not found' },
        { sourceType: 'lesson', sourceId: 'les-1', score: 0.85, text: 'Always check file exists' },
      ],
      query: 'file error',
      totalResults: 2,
    };
    mockFetch.mockResolvedValue(okResponse(data));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_recall',
      arguments: { query: 'file error' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Found 2 result(s)');
    expect(content[0].text).toContain('tool_error: readFile');
    expect(content[0].text).toContain('[event]');
    expect(content[0].text).toContain('[lesson]');
    expect(content[0].text).toContain('92.0% match');
  });

  it('sends correct query params to server', async () => {
    mockFetch.mockResolvedValue(okResponse({ results: [], query: 'test', totalResults: 0 }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_recall',
      arguments: {
        query: 'file error',
        scope: 'events',
        limit: 5,
        minScore: 0.5,
        from: '2025-01-01',
        to: '2025-12-31',
      },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/recall?');
    expect(url).toContain('query=file+error');
    expect(url).toContain('scope=events');
    expect(url).toContain('limit=5');
    expect(url).toContain('minScore=0.5');
    expect(url).toContain('from=2025-01-01');
    expect(url).toContain('to=2025-12-31');
  });

  it('returns message when no results found', async () => {
    mockFetch.mockResolvedValue(okResponse({ results: [], query: 'test', totalResults: 0 }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_recall',
      arguments: { query: 'nothing found' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('No results found');
  });
});

describe('agentlens_recall error handling', () => {
  it('handles server errors', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_recall',
      arguments: { query: 'test' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('500');
  });

  it('handles 503 when embeddings not configured', async () => {
    mockFetch.mockResolvedValue(errorResponse(503, 'Embedding service not configured'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_recall',
      arguments: { query: 'test' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('503');
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_recall',
      arguments: { query: 'test' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Connection refused');
  });
});

describe('transport.recall', () => {
  it('calls GET /api/recall with query params', async () => {
    mockFetch.mockResolvedValue(okResponse({ results: [], query: 'test', totalResults: 0 }));

    const transport = new AgentLensTransport({
      baseUrl: 'http://localhost:3400',
      apiKey: 'test-key',
    });

    await transport.recall({ query: 'test query', scope: 'lessons', limit: 5 });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('http://localhost:3400/api/recall?');
    expect(url).toContain('query=test+query');
    expect(url).toContain('scope=lessons');
    expect(url).toContain('limit=5');

    const opts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe('GET');
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
  });

  it('omits optional params when not provided', async () => {
    mockFetch.mockResolvedValue(okResponse({ results: [], query: 'test', totalResults: 0 }));

    const transport = new AgentLensTransport({
      baseUrl: 'http://localhost:3400',
    });

    await transport.recall({ query: 'test' });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('query=test');
    expect(url).not.toContain('scope=');
    expect(url).not.toContain('limit=');
    expect(url).not.toContain('minScore=');
  });
});
