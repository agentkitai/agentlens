/**
 * Tests for agentlens_log_llm_call MCP tool (Story 3.1 / 3.3)
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

const baseLlmArgs = {
  sessionId: 'ses_test123',
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  messages: [
    { role: 'user' as const, content: 'Hello, how are you?' },
  ],
  completion: 'I am doing well, thank you!',
  finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  costUsd: 0.05,
  latencyMs: 1200,
};

describe('agentlens_log_llm_call registration', () => {
  it('registers the tool and appears in tool list', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);

    expect(toolNames).toContain('agentlens_log_llm_call');
  });

  it('now registers 9 tools total', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    expect(result.tools).toHaveLength(9);
  });

  it('has a description', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_log_llm_call');
    expect(tool).toBeDefined();
    expect(tool!.description).toBeTruthy();
    expect(tool!.description).toContain('LLM');
  });

  it('has correct required input fields', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_log_llm_call');
    expect(tool).toBeDefined();

    const required = tool!.inputSchema.required ?? [];
    expect(required).toContain('sessionId');
    expect(required).toContain('provider');
    expect(required).toContain('model');
    expect(required).toContain('messages');
    expect(required).toContain('finishReason');
    expect(required).toContain('usage');
    expect(required).toContain('costUsd');
    expect(required).toContain('latencyMs');
  });
});

describe('agentlens_log_llm_call invocation', () => {
  it('emits two events and returns callId', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as { callId: string; eventsLogged: number };
    expect(parsed.callId).toBeTruthy();
    expect(parsed.eventsLogged).toBe(2);
  });

  it('sends llm_call event first, then llm_response event', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: llm_call event
    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ eventType: string; payload: Record<string, unknown> }>;
    };
    expect(call1Body.events).toHaveLength(1);
    expect(call1Body.events[0].eventType).toBe('llm_call');
    expect(call1Body.events[0].payload.provider).toBe('anthropic');
    expect(call1Body.events[0].payload.model).toBe('claude-opus-4-6');
    expect(call1Body.events[0].payload.messages).toEqual(baseLlmArgs.messages);

    // Second call: llm_response event
    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ eventType: string; payload: Record<string, unknown> }>;
    };
    expect(call2Body.events).toHaveLength(1);
    expect(call2Body.events[0].eventType).toBe('llm_response');
    expect(call2Body.events[0].payload.completion).toBe('I am doing well, thank you!');
    expect(call2Body.events[0].payload.finishReason).toBe('stop');
    expect(call2Body.events[0].payload.costUsd).toBe(0.05);
  });

  it('both events share the same callId', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ payload: { callId: string } }>;
    };
    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ payload: { callId: string } }>;
    };

    expect(call1Body.events[0].payload.callId).toBeTruthy();
    expect(call1Body.events[0].payload.callId).toBe(call2Body.events[0].payload.callId);
  });

  it('uses stored agentId for the session', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client, transport } = await createTestSetup();
    transport.setSessionAgent('ses_test123', 'my-agent');

    await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ agentId: string }>;
    };
    expect(call1Body.events[0].agentId).toBe('my-agent');
  });

  it('includes optional fields when provided', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: {
        ...baseLlmArgs,
        systemPrompt: 'You are a helpful assistant.',
        parameters: { temperature: 0.7, maxTokens: 1000 },
        tools: [{ name: 'search', description: 'Search the web' }],
        toolCalls: [{ id: 'tc_1', name: 'search', arguments: { q: 'hello' } }],
      },
    });

    const call1Body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(call1Body.events[0].payload.systemPrompt).toBe('You are a helpful assistant.');
    expect(call1Body.events[0].payload.parameters).toEqual({ temperature: 0.7, maxTokens: 1000 });
    expect(call1Body.events[0].payload.tools).toEqual([{ name: 'search', description: 'Search the web' }]);

    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ payload: Record<string, unknown> }>;
    };
    expect(call2Body.events[0].payload.toolCalls).toEqual([
      { id: 'tc_1', name: 'search', arguments: { q: 'hello' } },
    ]);
  });

  it('handles null completion', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: { ...baseLlmArgs, completion: null },
    });

    const call2Body = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ payload: { completion: string | null } }>;
    };
    expect(call2Body.events[0].payload.completion).toBeNull();
  });

  it('returns error when llm_call POST fails', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('500');
  });

  it('returns error when llm_response POST fails', async () => {
    mockFetch
      .mockResolvedValueOnce(okResponse()) // llm_call succeeds
      .mockResolvedValueOnce(errorResponse(400, 'Bad Request')); // llm_response fails
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('400');
  });

  it('returns error when server is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_llm_call',
      arguments: baseLlmArgs,
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Connection refused');
  });
});
