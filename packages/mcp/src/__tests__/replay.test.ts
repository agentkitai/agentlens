/**
 * Tests for agentlens_replay MCP tool (Story 4.1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { AgentLensTransport } from '../transport.js';
import {
  formatReplay,
  formatReplayHeader,
  formatReplayStep,
  type ReplayResponse,
} from '../tools/replay.js';

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

const MOCK_REPLAY: ReplayResponse = {
  sessionId: 'ses_abc123',
  agentId: 'test-agent',
  status: 'completed',
  startedAt: '2026-02-08T10:00:00.000Z',
  endedAt: '2026-02-08T10:05:30.000Z',
  durationMs: 330000,
  totalCostUsd: 0.0452,
  eventCounts: {
    llm_call: 3,
    tool_call: 2,
    llm_response: 3,
    tool_response: 2,
  },
  steps: [
    {
      index: 1,
      timestamp: '2026-02-08T10:00:01.000Z',
      eventType: 'llm_call',
      severity: 'info',
      summary: 'Called claude-3.5-sonnet with 3 messages',
      durationMs: 1200,
      costUsd: 0.012,
    },
    {
      index: 2,
      timestamp: '2026-02-08T10:00:02.200Z',
      eventType: 'llm_response',
      severity: 'info',
      summary: 'Response: 245 tokens, finish_reason: tool_use',
      paired: true,
    },
    {
      index: 3,
      timestamp: '2026-02-08T10:00:03.000Z',
      eventType: 'tool_call',
      severity: 'info',
      summary: 'search_files({ query: "error handler" })',
      durationMs: 800,
    },
    {
      index: 4,
      timestamp: '2026-02-08T10:00:03.800Z',
      eventType: 'tool_response',
      severity: 'info',
      summary: 'Returned 5 results',
      paired: true,
    },
    {
      index: 5,
      timestamp: '2026-02-08T10:05:00.000Z',
      eventType: 'llm_call',
      severity: 'error',
      summary: 'Called gpt-4o with 8 messages',
      error: 'Rate limit exceeded',
      costUsd: 0.033,
    },
  ],
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

describe('agentlens_replay', () => {
  it('tool is registered with correct schema', async () => {
    const { client } = await createTestSetup();

    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === 'agentlens_replay');
    expect(tool).toBeDefined();
    expect(tool!.description).toContain('Replay');

    const schema = tool!.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(schema.properties).toHaveProperty('sessionId');
    expect(schema.properties).toHaveProperty('fromStep');
    expect(schema.properties).toHaveProperty('toStep');
    expect(schema.properties).toHaveProperty('eventTypes');
    expect(schema.properties).toHaveProperty('summaryOnly');
    expect(schema.required).toContain('sessionId');
  });

  it('returns formatted replay with steps', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_REPLAY));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'ses_abc123' },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    // Header checks
    expect(text).toContain('📼 Session Replay: ses_abc123');
    expect(text).toContain('Agent: test-agent');
    expect(text).toContain('Status: completed');
    expect(text).toContain('Duration: 5m 30s');
    expect(text).toContain('Total Cost: $0.0452');

    // Step checks
    expect(text).toContain('🤖 llm_call');
    expect(text).toContain('🔧 tool_call');
    expect(text).toContain('⚠️ Error: Rate limit exceeded');
  });

  it('returns summary only when summaryOnly=true', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_REPLAY));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'ses_abc123', summaryOnly: true },
    });

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const text = content[0]!.text;

    // Header present
    expect(text).toContain('📼 Session Replay: ses_abc123');
    expect(text).toContain('Agent: test-agent');

    // Steps absent
    expect(text).not.toContain('🤖 llm_call');
    expect(text).not.toContain('search_files');
  });

  it('passes step range as offset/limit', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_REPLAY));

    const { client } = await createTestSetup();
    await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'ses_abc123', fromStep: 2, toStep: 4 },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('offset=2');
    expect(fetchUrl).toContain('limit=3');
  });

  it('passes eventTypes filter', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(MOCK_REPLAY));

    const { client } = await createTestSetup();
    await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'ses_abc123', eventTypes: 'llm_call,tool_call' },
    });

    const fetchUrl = mockFetch.mock.calls[0]![0] as string;
    expect(fetchUrl).toContain('eventTypes=llm_call%2Ctool_call');
  });

  it('returns error for invalid session (404)', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, '{"error":"Not found"}'));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'nonexistent' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Session not found: nonexistent');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const { client } = await createTestSetup();
    const result = await client.callTool({
      name: 'agentlens_replay',
      arguments: { sessionId: 'ses_abc123' },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]!.text).toContain('Connection refused');
  });
});

describe('formatReplay', () => {
  it('formats header correctly', () => {
    const header = formatReplayHeader(MOCK_REPLAY);
    expect(header).toContain('📼 Session Replay: ses_abc123');
    expect(header).toContain('Agent: test-agent');
    expect(header).toContain('Status: completed');
    expect(header).toContain('Duration: 5m 30s');
    expect(header).toContain('Total Cost: $0.0452');
    expect(header).toContain('llm_call: 3');
  });

  it('formats step with icon and summary', () => {
    const step = formatReplayStep(MOCK_REPLAY.steps[0]!);
    expect(step).toContain('🤖 llm_call');
    expect(step).toContain('Called claude-3.5-sonnet with 3 messages');
    expect(step).toContain('1.2s');
    expect(step).toContain('$0.0120');
  });

  it('formats error step with warning icon', () => {
    const step = formatReplayStep(MOCK_REPLAY.steps[4]!);
    expect(step).toContain('⚠️');
    expect(step).toContain('Rate limit exceeded');
  });

  it('includes context annotations (cost-so-far, error count)', () => {
    const step = formatReplayStep(MOCK_REPLAY.steps[4]!, 0.045, 1);
    expect(step).toContain('cost-so-far: $0.0450');
    expect(step).toContain('errors: 1');
  });

  it('summary only returns just the header', () => {
    const text = formatReplay(MOCK_REPLAY, true);
    expect(text).toContain('📼 Session Replay');
    expect(text).not.toContain('🤖');
  });

  it('full replay includes header and steps', () => {
    const text = formatReplay(MOCK_REPLAY, false);
    expect(text).toContain('📼 Session Replay');
    expect(text).toContain('🤖 llm_call');
    expect(text).toContain('🔧 tool_call');
    expect(text).toContain('⚠️');
  });

  it('shows "(No steps to display)" for empty steps', () => {
    const empty: ReplayResponse = {
      ...MOCK_REPLAY,
      steps: [],
    };
    const text = formatReplay(empty, false);
    expect(text).toContain('(No steps to display)');
  });
});
