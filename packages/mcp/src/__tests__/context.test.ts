/**
 * Tests for agentlens_context MCP tool (Story 5.3)
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

describe('agentlens_context', () => {
  it('calls the context API with correct parameters', async () => {
    const contextResult = {
      topic: 'deployment',
      sessions: [
        {
          sessionId: 'ses-1',
          agentId: 'agent-1',
          summary: 'Agent deployed to production',
          relevanceScore: 0.85,
          startedAt: '2024-01-01T00:00:00Z',
          endedAt: '2024-01-01T01:00:00Z',
          keyEvents: [
            { id: 'ev-1', eventType: 'tool_call', summary: 'tool_call: deploy()', timestamp: '2024-01-01T00:30:00Z' },
          ],
        },
      ],
      lessons: [
        {
          id: 'les-1',
          title: 'Always verify deploy',
          content: 'Check health endpoint after deploying',
          category: 'operations',
          importance: 'high',
          relevanceScore: 0.78,
        },
      ],
      totalSessions: 1,
    };

    mockFetch.mockResolvedValueOnce(okResponse(contextResult));

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: {
        topic: 'deployment',
        agentId: 'my-agent',
        limit: 5,
      },
    });

    // Verify the fetch was called with the right URL
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/context?'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('topic=deployment');
    expect(fetchUrl).toContain('agentId=my-agent');
    expect(fetchUrl).toContain('limit=5');

    // Verify the result contains formatted data
    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('ses-1');
    expect(content[0]!.text).toContain('deployed to production');
    expect(content[0]!.text).toContain('Always verify deploy');
  });

  it('handles empty results gracefully', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        topic: 'nonexistent',
        sessions: [],
        lessons: [],
        totalSessions: 0,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'nonexistent' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('No relevant context found');
  });

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, 'Internal Server Error'),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'test' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Error retrieving context');
  });

  it('returns error on network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'test' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });

  it('handles sessions-only results (no lessons)', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        topic: 'file operations',
        sessions: [
          {
            sessionId: 'ses-1',
            agentId: 'agent-1',
            summary: 'Agent ran file operations',
            relevanceScore: 0.9,
            startedAt: '2024-01-01T00:00:00Z',
            keyEvents: [],
          },
        ],
        lessons: [],
        totalSessions: 1,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'file operations' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Related Sessions (1)');
    expect(content[0]!.text).toContain('file operations');
  });

  it('handles lessons-only results (no sessions)', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        topic: 'database',
        sessions: [],
        lessons: [
          {
            id: 'les-1',
            title: 'Database tips',
            content: 'Always index your queries',
            category: 'performance',
            importance: 'normal',
            relevanceScore: 0.75,
          },
        ],
        totalSessions: 0,
      }),
    );

    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'database' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Database tips');
    expect(content[0]!.text).toContain('Related Lessons (1)');
  });

  it('sends optional userId parameter', async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse({
        topic: 'test',
        sessions: [],
        lessons: [],
        totalSessions: 0,
      }),
    );

    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_context',
      arguments: { topic: 'test', userId: 'user-123' },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('userId=user-123');
  });
});
