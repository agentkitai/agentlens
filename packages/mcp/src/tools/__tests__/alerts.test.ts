/**
 * Tests for agentlens_alerts MCP Tool (Feature 10, Story 10.8)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerAlertsTool } from '../alerts.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_alerts', () => {
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
    registerAlertsTool(server, transport);
  });

  it('lists alert rules', async () => {
    vi.spyOn(transport, 'listAlertRules').mockResolvedValue(mockResponse({ rules: [] }));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBeUndefined();
  });

  it('creates alert rule', async () => {
    vi.spyOn(transport, 'createAlertRule').mockResolvedValue(mockResponse({ id: 'r1' }));
    const result = await toolHandler({
      action: 'create', name: 'High errors', condition: 'error_rate_above', threshold: 0.1, windowMinutes: 60,
    });
    expect(result.isError).toBeUndefined();
    expect(transport.createAlertRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'High errors', condition: 'error_rate_above', threshold: 0.1 }));
  });

  it('validates create requires name', async () => {
    const result = await toolHandler({ action: 'create', condition: 'error_rate_above', threshold: 0.1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('name');
  });

  it('validates create requires condition', async () => {
    const result = await toolHandler({ action: 'create', name: 'Test', threshold: 0.1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('condition');
  });

  it('validates create requires threshold', async () => {
    const result = await toolHandler({ action: 'create', name: 'Test', condition: 'error_rate_above' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('threshold');
  });

  it('updates alert rule', async () => {
    vi.spyOn(transport, 'updateAlertRule').mockResolvedValue(mockResponse({ id: 'r1' }));
    const result = await toolHandler({ action: 'update', ruleId: 'r1', enabled: false });
    expect(result.isError).toBeUndefined();
  });

  it('validates update requires ruleId', async () => {
    const result = await toolHandler({ action: 'update', enabled: false });
    expect(result.isError).toBe(true);
  });

  it('deletes alert rule', async () => {
    vi.spyOn(transport, 'deleteAlertRule').mockResolvedValue(mockResponse(null));
    const result = await toolHandler({ action: 'delete', ruleId: 'r1' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('r1');
  });

  it('validates delete requires ruleId', async () => {
    const result = await toolHandler({ action: 'delete' });
    expect(result.isError).toBe(true);
  });

  it('gets alert history', async () => {
    vi.spyOn(transport, 'getAlertHistory').mockResolvedValue(mockResponse({ history: [] }));
    const result = await toolHandler({ action: 'history', limit: 10 });
    expect(result.isError).toBeUndefined();
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'listAlertRules').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });
});
