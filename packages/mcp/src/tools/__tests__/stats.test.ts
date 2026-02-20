/**
 * Tests for agentlens_stats MCP Tool (Feature 10, Story 10.12)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerStatsTool } from '../stats.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_stats', () => {
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
    registerStatsTool(server, transport);
  });

  it('gets storage stats', async () => {
    vi.spyOn(transport, 'getStats').mockResolvedValue(mockResponse({ dbSize: 1024 }));
    const result = await toolHandler({ action: 'storage' });
    expect(result.isError).toBeUndefined();
  });

  it('gets overview', async () => {
    vi.spyOn(transport, 'getStatsOverview').mockResolvedValue(mockResponse({ sessions: 10 }));
    const result = await toolHandler({ action: 'overview' });
    expect(result.isError).toBeUndefined();
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'getStats').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'storage' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });
});
