/**
 * Tests for MCP Tool Handlers (Stories 5.2–5.5)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from './tools.js';
import { AgentLensTransport } from './transport.js';

// Mock global fetch for the transport layer
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

/**
 * Helper to create connected MCP server + client pair for testing.
 */
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

describe('Tool Registration (Story 5.1)', () => {
  it('registers all 15 tools', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();

    expect(toolNames).toEqual([
      'agentlens_benchmark',
      'agentlens_context',
      'agentlens_delegate',
      'agentlens_discover',
      'agentlens_guardrails',
      'agentlens_health',
      'agentlens_log_event',
      'agentlens_log_llm_call',
      'agentlens_optimize',
      'agentlens_query_events',
      'agentlens_recall',
      'agentlens_reflect',
      'agentlens_replay',
      'agentlens_session_end',
      'agentlens_session_start',
    ]);
  });

  it('each tool has a description', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it('agentlens_session_start has correct input schema', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_session_start');
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toHaveProperty('agentId');
    expect(tool!.inputSchema.required).toContain('agentId');
  });
});

describe('agentlens_session_start (Story 5.2)', () => {
  it('creates a session and returns sessionId', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'evt_1' }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'agent-1', agentName: 'Test Agent', tags: ['dev'] },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text) as { sessionId: string };
    expect(parsed.sessionId).toMatch(/^ses_/);
  });

  it('sends session_started event to API server in batch format', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'agent-1' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3400/api/events',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"events"'),
      }),
    );
    // Verify the body contains session_started in the events array
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ eventType: string }>;
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventType).toBe('session_started');
  });

  it('returns error when server is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'agent-1' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Connection refused');
  });

  it('returns error when server responds with error', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Internal Server Error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'agent-1' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('500');
  });
});

describe('agentId propagation (Issue 3)', () => {
  it('session_start stores agentId, log_event uses it', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    // Start session
    const startResult = await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'my-agent' },
    });
    const content = startResult.content as Array<{ type: string; text: string }>;
    const { sessionId } = JSON.parse(content[0].text) as { sessionId: string };

    // Log event
    await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId,
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      },
    });

    // Check that the log_event call used the correct agentId
    const logBody = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ agentId: string }>;
    };
    expect(logBody.events[0].agentId).toBe('my-agent');
  });

  it('session_end uses stored agentId and cleans up mapping', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    // Start session
    const startResult = await client.callTool({
      name: 'agentlens_session_start',
      arguments: { agentId: 'my-agent' },
    });
    const content = startResult.content as Array<{ type: string; text: string }>;
    const { sessionId } = JSON.parse(content[0].text) as { sessionId: string };

    // End session
    await client.callTool({
      name: 'agentlens_session_end',
      arguments: { sessionId, reason: 'completed' },
    });

    // Check that session_end used the correct agentId
    const endBody = JSON.parse(mockFetch.mock.calls[1][1].body as string) as {
      events: Array<{ agentId: string }>;
    };
    expect(endBody.events[0].agentId).toBe('my-agent');
  });

  it('log_event falls back to empty string for unknown session', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId: 'unknown-session',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      },
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ agentId: string }>;
    };
    expect(body.events[0].agentId).toBe('');
  });
});

describe('agentlens_log_event (Story 5.3)', () => {
  it('logs an event and returns confirmation', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'evt_2' }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId: 'ses_123',
        eventType: 'tool_call',
        payload: { toolName: 'search', callId: 'c1', arguments: { q: 'hello' } },
        severity: 'info',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Event logged: tool_call');
    expect(content[0].text).toContain('severity: info');
  });

  it('POSTs event to /api/events', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId: 'ses_123',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3400/api/events',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('defaults severity to info', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId: 'ses_123',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('severity: info');
  });

  it('handles server errors', async () => {
    mockFetch.mockResolvedValue(errorResponse(400, 'Bad Request'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_log_event',
      arguments: {
        sessionId: 'ses_123',
        eventType: 'custom',
        payload: { type: 'test', data: {} },
      },
    });

    expect(result.isError).toBe(true);
  });
});

describe('agentlens_session_end (Story 5.4)', () => {
  it('ends a session with reason', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_session_end',
      arguments: {
        sessionId: 'ses_123',
        reason: 'completed',
        summary: 'All tasks done',
      },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('ses_123');
    expect(content[0].text).toContain('completed');
  });

  it('sends session_ended event with correct payload', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_session_end',
      arguments: {
        sessionId: 'ses_123',
        reason: 'error',
      },
    });

    const wrapper = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{
        eventType: string;
        severity: string;
        payload: { reason: string };
      }>;
    };
    const body = wrapper.events[0];
    expect(body.eventType).toBe('session_ended');
    expect(body.payload.reason).toBe('error');
    expect(body.severity).toBe('error');
  });

  it('sets severity to error when reason is error', async () => {
    mockFetch.mockResolvedValue(okResponse());
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_session_end',
      arguments: { sessionId: 'ses_123', reason: 'error' },
    });

    const wrapper = JSON.parse(mockFetch.mock.calls[0][1].body as string) as {
      events: Array<{ severity: string }>;
    };
    expect(wrapper.events[0].severity).toBe('error');
  });

  it('handles server errors', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_session_end',
      arguments: { sessionId: 'ses_123', reason: 'manual' },
    });

    expect(result.isError).toBe(true);
  });
});

describe('agentlens_query_events (Story 5.5)', () => {
  it('queries events and returns summarized format', async () => {
    const events = [
      {
        eventType: 'tool_call',
        timestamp: '2025-01-01T00:00:00Z',
        severity: 'info',
        payload: { toolName: 'search', callId: 'c1', arguments: { q: 'hello' } },
      },
      {
        eventType: 'tool_response',
        timestamp: '2025-01-01T00:00:01Z',
        severity: 'info',
        payload: { callId: 'c1', toolName: 'search', result: 'found', durationMs: 100 },
      },
    ];

    mockFetch.mockResolvedValue(okResponse({ events }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_query_events',
      arguments: { sessionId: 'ses_123' },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Found 2 event(s)');
    expect(content[0].text).toContain('tool_call');
    expect(content[0].text).toContain('tool_response');
  });

  it('passes query params to transport', async () => {
    mockFetch.mockResolvedValue(okResponse({ events: [] }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_query_events',
      arguments: { sessionId: 'ses_123', limit: 10, eventType: 'tool_call' },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('sessionId=ses_123');
    expect(url).toContain('limit=10');
    expect(url).toContain('eventType=tool_call');
  });

  it('returns message when no events found', async () => {
    mockFetch.mockResolvedValue(okResponse({ events: [] }));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_query_events',
      arguments: { sessionId: 'ses_123' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('No events found');
  });

  it('defaults limit to 50', async () => {
    mockFetch.mockResolvedValue(okResponse({ events: [] }));
    const { client } = await createTestSetup();

    await client.callTool({
      name: 'agentlens_query_events',
      arguments: { sessionId: 'ses_123' },
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('limit=50');
  });

  it('handles server errors', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'Server error'));
    const { client } = await createTestSetup();

    const result = await client.callTool({
      name: 'agentlens_query_events',
      arguments: { sessionId: 'ses_123' },
    });

    expect(result.isError).toBe(true);
  });
});
