/**
 * Tests for agentlens_agents MCP Tool (Feature 10, Story 10.7)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerAgentsTool } from '../agents.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_agents', () => {
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
    registerAgentsTool(server, transport);
  });

  it('lists agents', async () => {
    vi.spyOn(transport, 'listAgents').mockResolvedValue(mockResponse({ agents: [] }));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBeUndefined();
  });

  it('gets agent detail', async () => {
    vi.spyOn(transport, 'getAgent').mockResolvedValue(mockResponse({ id: 'a1' }));
    const result = await toolHandler({ action: 'detail', agentId: 'a1' });
    expect(result.isError).toBeUndefined();
  });

  it('requires agentId for detail', async () => {
    const result = await toolHandler({ action: 'detail' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('agentId');
  });

  it('unpauses agent', async () => {
    vi.spyOn(transport, 'unpauseAgent').mockResolvedValue(mockResponse({ ok: true }));
    const result = await toolHandler({ action: 'unpause', agentId: 'a1', clearModelOverride: true });
    expect(result.isError).toBeUndefined();
    expect(transport.unpauseAgent).toHaveBeenCalledWith('a1', true);
  });

  it('requires agentId for unpause', async () => {
    const result = await toolHandler({ action: 'unpause' });
    expect(result.isError).toBe(true);
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'getAgent').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'detail', agentId: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });
});
