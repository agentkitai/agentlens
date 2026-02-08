/**
 * Tests for MCP Server Entrypoint (Story 5.1)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from './index.js';

// Mock global fetch for the transport layer
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MCP Server Entrypoint (Story 5.1)', () => {
  it('creates a server with tools capability', () => {
    const { mcpServer } = createServer();
    expect(mcpServer).toBeDefined();
  });

  it('creates a transport with default URL', () => {
    delete process.env['AGENTLENS_URL'];
    const { transport } = createServer();
    expect(transport).toBeDefined();
  });

  it('lists all 5 tools via MCP protocol', async () => {
    const { mcpServer } = createServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(5);

    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'agentlens_log_event',
      'agentlens_log_llm_call',
      'agentlens_query_events',
      'agentlens_session_end',
      'agentlens_session_start',
    ]);
  });

  it('all tools have descriptions and input schemas', async () => {
    const { mcpServer } = createServer();

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await mcpServer.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('respects AGENTLENS_URL env var', () => {
    process.env['AGENTLENS_URL'] = 'http://custom:9999';
    const { transport } = createServer();
    expect(transport).toBeDefined();
    // Verify by sending an event
    mockFetch.mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    void transport.sendEventImmediate({
      sessionId: 's',
      agentId: 'a',
      eventType: 'custom',
      payload: {},
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom:9999/api/events',
      expect.anything(),
    );
    delete process.env['AGENTLENS_URL'];
  });
});
