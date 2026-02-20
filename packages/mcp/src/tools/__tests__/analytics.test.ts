/**
 * Tests for agentlens_analytics MCP Tool (Feature 10, Story 10.9)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerAnalyticsTool } from '../analytics.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_analytics', () => {
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
    registerAnalyticsTool(server, transport);
  });

  it('gets metrics', async () => {
    vi.spyOn(transport, 'getAnalytics').mockResolvedValue(mockResponse({ buckets: [] }));
    const result = await toolHandler({ action: 'metrics', range: '24h' });
    expect(result.isError).toBeUndefined();
    expect(transport.getAnalytics).toHaveBeenCalledWith(expect.objectContaining({ range: '24h' }));
  });

  it('gets costs', async () => {
    vi.spyOn(transport, 'getAnalyticsCosts').mockResolvedValue(mockResponse({ costs: {} }));
    const result = await toolHandler({ action: 'costs' });
    expect(result.isError).toBeUndefined();
  });

  it('gets agent metrics with date range', async () => {
    vi.spyOn(transport, 'getAnalyticsAgents').mockResolvedValue(mockResponse({ agents: [] }));
    const result = await toolHandler({ action: 'agents', from: '2026-01-01', to: '2026-02-01' });
    expect(result.isError).toBeUndefined();
    expect(transport.getAnalyticsAgents).toHaveBeenCalledWith(expect.objectContaining({ from: '2026-01-01', to: '2026-02-01' }));
  });

  it('gets tool usage', async () => {
    vi.spyOn(transport, 'getAnalyticsTools').mockResolvedValue(mockResponse({ tools: [] }));
    const result = await toolHandler({ action: 'tools' });
    expect(result.isError).toBeUndefined();
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'getAnalytics').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'metrics' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });
});
