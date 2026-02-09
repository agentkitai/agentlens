/**
 * Tests for agentlens_delegate MCP Tool (Story 7.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerDelegateTool } from '../delegate.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe('agentlens_delegate MCP Tool', () => {
  let server: McpServer;
  let transport: AgentLensTransport;
  let toolHandler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' }, { capabilities: { tools: {} } });
    transport = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });

    const origTool = server.tool.bind(server);
    vi.spyOn(server, 'tool').mockImplementation((...args: unknown[]) => {
      const handler = args[args.length - 1] as typeof toolHandler;
      toolHandler = handler;
      return origTool(...(args as Parameters<typeof origTool>));
    });

    registerDelegateTool(server, transport);
  });

  it('should require targetAgentId', async () => {
    const result = await toolHandler({ action: 'delegate', taskType: 'translation', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('targetAgentId is required');
  });

  it('should require taskType', async () => {
    const result = await toolHandler({ action: 'delegate', targetAgentId: 'anon-1', input: {} });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('taskType is required');
  });

  it('should require input', async () => {
    const result = await toolHandler({ action: 'delegate', targetAgentId: 'anon-1', taskType: 'translation' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('input is required');
  });

  it('should delegate successfully', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({
        requestId: 'req-123',
        status: 'success',
        output: { translated: 'Hola' },
        executionTimeMs: 1500,
      }),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-abc',
      taskType: 'translation',
      input: { text: 'Hello', targetLang: 'es' },
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Delegation successful');
    expect(result.content[0].text).toContain('req-123');
    expect(result.content[0].text).toContain('1500ms');
    expect(result.content[0].text).toContain('Hola');
  });

  it('should show retries used', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({
        requestId: 'req-456',
        status: 'success',
        output: 'result',
        executionTimeMs: 3000,
        retriesUsed: 2,
      }),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'analysis',
      input: { data: [1, 2, 3] },
    });

    expect(result.content[0].text).toContain('Retries used: 2');
  });

  it('should handle rejected delegation', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({ requestId: 'req-789', status: 'rejected' }),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'code-review',
      input: { code: 'console.log("hi")' },
    });

    expect(result.content[0].text).toContain('rejected');
  });

  it('should handle timeout', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({ requestId: 'req-t', status: 'timeout' }),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'generation',
      input: {},
    });

    expect(result.content[0].text).toContain('timeout');
  });

  it('should pass optional params', async () => {
    const spy = vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({ requestId: 'req-1', status: 'success', output: null }),
    );

    await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'analysis',
      input: {},
      fallbackEnabled: true,
      maxRetries: 5,
      timeoutMs: 60000,
    });

    expect(spy).toHaveBeenCalledWith({
      targetAnonymousId: 'anon-1',
      taskType: 'analysis',
      input: {},
      fallbackEnabled: true,
      maxRetries: 5,
      timeoutMs: 60000,
    });
  });

  it('should handle API errors', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse('error', false, 500),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'code-review',
      input: {},
    });

    expect(result.isError).toBe(true);
  });

  it('should handle network errors', async () => {
    vi.spyOn(transport, 'delegate').mockRejectedValue(new Error('Timeout'));

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'code-review',
      input: {},
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Timeout');
  });

  it('should handle error status with details', async () => {
    vi.spyOn(transport, 'delegate').mockResolvedValue(
      mockResponse({ requestId: 'req-e', status: 'error', output: 'Agent unreachable' }),
    );

    const result = await toolHandler({
      action: 'delegate',
      targetAgentId: 'anon-1',
      taskType: 'analysis',
      input: {},
    });

    expect(result.content[0].text).toContain('error');
    expect(result.content[0].text).toContain('Agent unreachable');
  });

  it('should handle unknown action', async () => {
    const result = await toolHandler({ action: 'unknown' as any });
    expect(result.isError).toBe(true);
  });
});
