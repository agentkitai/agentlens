/**
 * Tests for agentlens_sessions MCP Tool (Feature 10, Story 10.6)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerSessionsTool } from '../sessions.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_sessions', () => {
  let transport: AgentLensTransport;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    transport = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });

    const origTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      toolHandler = args[args.length - 1] as typeof toolHandler;
      return origTool(...(args as Parameters<typeof origTool>));
    });

    registerSessionsTool(server, transport);
  });

  it('lists sessions', async () => {
    vi.spyOn(transport, 'listSessions').mockResolvedValue(mockResponse({ sessions: [], total: 0 }));
    const result = await toolHandler({ action: 'list', agentId: 'a1' });
    expect(result.isError).toBeUndefined();
    expect(transport.listSessions).toHaveBeenCalledWith({ agentId: 'a1' });
  });

  it('gets session detail', async () => {
    vi.spyOn(transport, 'getSession').mockResolvedValue(mockResponse({ id: 's1' }));
    const result = await toolHandler({ action: 'detail', sessionId: 's1' });
    expect(result.isError).toBeUndefined();
  });

  it('requires sessionId for detail', async () => {
    const result = await toolHandler({ action: 'detail' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('sessionId');
  });

  it('gets session timeline', async () => {
    vi.spyOn(transport, 'getSessionTimeline').mockResolvedValue(mockResponse({ events: [] }));
    const result = await toolHandler({ action: 'timeline', sessionId: 's1' });
    expect(result.isError).toBeUndefined();
  });

  it('requires sessionId for timeline', async () => {
    const result = await toolHandler({ action: 'timeline' });
    expect(result.isError).toBe(true);
  });

  it('handles 404 with upgrade suggestion', async () => {
    vi.spyOn(transport, 'listSessions').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });

  it('handles network errors', async () => {
    vi.spyOn(transport, 'listSessions').mockRejectedValue(new Error('Connection refused'));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
  });
});
