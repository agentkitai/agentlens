/**
 * Tests for agentlens_trust MCP Tool (Feature 10, Story 10.13)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerTrustTool } from '../trust.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_trust', () => {
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
    registerTrustTool(server, transport);
  });

  it('gets trust score', async () => {
    vi.spyOn(transport, 'getTrustScore').mockResolvedValue(mockResponse({ score: 85, percentile: 90 }));
    const result = await toolHandler({ action: 'score', agentId: 'a1' });
    expect(result.isError).toBeUndefined();
  });

  it('requires agentId', async () => {
    const result = await toolHandler({ action: 'score' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('agentId');
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'getTrustScore').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'score', agentId: 'x' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });

  it('handles network errors', async () => {
    vi.spyOn(transport, 'getTrustScore').mockRejectedValue(new Error('Connection refused'));
    const result = await toolHandler({ action: 'score', agentId: 'x' });
    expect(result.isError).toBe(true);
  });
});
