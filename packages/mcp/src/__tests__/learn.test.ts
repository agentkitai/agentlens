/**
 * Tests for agentlens_learn MCP tool (Story 3.3)
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

function createdResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 201,
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

describe('agentlens_learn registration', () => {
  it('registers the tool', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain('agentlens_learn');
  });

  it('registers 6 tools total', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(8);
  });

  it('has a description', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_learn');
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain('lesson');
  });

  it('has action as required field', async () => {
    const { client } = await createTestSetup();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_learn');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain('action');
  });
});

describe('agentlens_learn save', () => {
  it('creates a lesson and returns it', async () => {
    const lessonData = {
      id: 'les_123',
      title: 'Always validate',
      content: 'Validate inputs at API boundary.',
      category: 'general',
      importance: 'normal',
    };
    mockFetch.mockResolvedValue(createdResponse(lessonData));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: {
        action: 'save',
        title: 'Always validate',
        content: 'Validate inputs at API boundary.',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe('les_123');
    expect(parsed.title).toBe('Always validate');
  });

  it('sends POST to /api/lessons', async () => {
    mockFetch.mockResolvedValue(createdResponse({ id: 'les_1' }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_learn',
      arguments: {
        action: 'save',
        title: 'Test',
        content: 'Content',
        category: 'arch',
        importance: 'high',
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3400/api/lessons',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.title).toBe('Test');
    expect(body.content).toBe('Content');
    expect(body.category).toBe('arch');
    expect(body.importance).toBe('high');
  });

  it('returns error when title is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'save', content: 'Content' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('title is required');
  });

  it('returns error when content is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'save', title: 'Title' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('content is required');
  });

  it('returns error when server fails', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Server error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'save', title: 'T', content: 'C' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('500');
  });
});

describe('agentlens_learn list', () => {
  it('lists lessons', async () => {
    const data = {
      lessons: [
        { id: 'l1', title: 'Lesson 1', category: 'general', importance: 'normal' },
        { id: 'l2', title: 'Lesson 2', category: 'arch', importance: 'high' },
      ],
      total: 2,
    };
    mockFetch.mockResolvedValue(okResponse(data));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'list' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Found 2 lesson(s)');
    expect(content[0].text).toContain('Lesson 1');
    expect(content[0].text).toContain('Lesson 2');
  });

  it('passes filter params to API', async () => {
    mockFetch.mockResolvedValue(okResponse({ lessons: [], total: 0 }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'list', category: 'arch', importance: 'high', limit: 5 },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('category=arch');
    expect(url).toContain('importance=high');
    expect(url).toContain('limit=5');
  });

  it('returns message when no lessons found', async () => {
    mockFetch.mockResolvedValue(okResponse({ lessons: [], total: 0 }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'list' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('No lessons found');
  });
});

describe('agentlens_learn get', () => {
  it('gets a lesson by ID', async () => {
    const lesson = { id: 'l1', title: 'Test', content: 'Content', accessCount: 1 };
    mockFetch.mockResolvedValue(okResponse(lesson));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'get', id: 'l1' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe('l1');
  });

  it('returns error when id is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'get' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('id is required');
  });

  it('handles 404', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, 'Not found'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'get', id: 'nonexistent' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('not found');
  });
});

describe('agentlens_learn update', () => {
  it('updates a lesson', async () => {
    const updated = { id: 'l1', title: 'Updated', content: 'Content' };
    mockFetch.mockResolvedValue(okResponse(updated));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'update', id: 'l1', title: 'Updated' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.title).toBe('Updated');
  });

  it('sends PUT to /api/lessons/:id', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'l1' }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'update', id: 'l1', title: 'Updated', importance: 'high' },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/lessons/l1');
    expect(mockFetch.mock.calls[0][1].method).toBe('PUT');
  });

  it('returns error when id is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'update', title: 'Updated' },
    });

    expect(result.isError).toBe(true);
  });

  it('handles 404', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, 'Not found'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'update', id: 'nonexistent', title: 'X' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('not found');
  });
});

describe('agentlens_learn delete', () => {
  it('archives a lesson', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'l1', archived: true }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'delete', id: 'l1' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('archived successfully');
  });

  it('sends DELETE to /api/lessons/:id', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'l1', archived: true }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'delete', id: 'l1' },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('/api/lessons/l1');
    expect(mockFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it('returns error when id is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'delete' },
    });

    expect(result.isError).toBe(true);
  });

  it('handles 404', async () => {
    mockFetch.mockResolvedValue(errorResponse(404, 'Not found'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'delete', id: 'nonexistent' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('agentlens_learn search', () => {
  it('searches lessons by text', async () => {
    const data = {
      lessons: [
        { id: 'l1', title: 'Rate limiting', category: 'api', importance: 'high', content: 'Use rate limiting on all public endpoints' },
      ],
      total: 1,
    };
    mockFetch.mockResolvedValue(okResponse(data));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'search', search: 'rate limiting' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Found 1 lesson(s)');
    expect(content[0].text).toContain('Rate limiting');
  });

  it('passes search param to API', async () => {
    mockFetch.mockResolvedValue(okResponse({ lessons: [], total: 0 }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'search', search: 'test query' },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('search=test+query');
  });

  it('returns error when search text is missing', async () => {
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'search' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('search is required');
  });

  it('returns message when no results', async () => {
    mockFetch.mockResolvedValue(okResponse({ lessons: [], total: 0 }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'search', search: 'nonexistent' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('No lessons found');
  });
});

describe('error handling', () => {
  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_learn',
      arguments: { action: 'save', title: 'T', content: 'C' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Connection refused');
  });
});
