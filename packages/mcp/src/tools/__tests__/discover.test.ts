/**
 * Tests for agentlens_discover MCP Tool (Story 7.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerDiscoverTool } from '../discover.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe('agentlens_discover MCP Tool', () => {
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

    registerDiscoverTool(server, transport);
  });

  it('should require taskType', async () => {
    const result = await toolHandler({ action: 'discover' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('taskType is required');
  });

  it('should discover agents successfully', async () => {
    vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse({
        results: [
          {
            anonymousAgentId: 'anon-abc',
            taskType: 'code-review',
            trustScorePercentile: 85,
            provisional: false,
            estimatedCostUsd: 0.05,
            estimatedLatencyMs: 2000,
            qualityMetrics: { successRate: 0.95, completedTasks: 100 },
          },
        ],
      }),
    );

    const result = await toolHandler({ action: 'discover', taskType: 'code-review' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Found 1 agent');
    expect(result.content[0].text).toContain('anon-abc');
    expect(result.content[0].text).toContain('Trust: 85%');
    expect(result.content[0].text).toContain('$0.0500');
    expect(result.content[0].text).toContain('2000ms');
    expect(result.content[0].text).toContain('95.0%');
  });

  it('should handle empty results', async () => {
    vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse({ results: [] }),
    );

    const result = await toolHandler({ action: 'discover', taskType: 'custom' });
    expect(result.content[0].text).toContain('No agents found');
  });

  it('should show provisional badge', async () => {
    vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse({
        results: [
          { anonymousAgentId: 'anon-1', taskType: 'translation', trustScorePercentile: 60, provisional: true, qualityMetrics: {} },
        ],
      }),
    );

    const result = await toolHandler({ action: 'discover', taskType: 'translation' });
    expect(result.content[0].text).toContain('provisional');
  });

  it('should pass all query params', async () => {
    const spy = vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse({ results: [] }),
    );

    await toolHandler({ action: 'discover', taskType: 'analysis', minTrustScore: 70, maxCost: 0.1, maxLatency: 5000, limit: 5 });
    expect(spy).toHaveBeenCalledWith({
      taskType: 'analysis',
      minTrustScore: '70',
      maxCostUsd: '0.1',
      maxLatencyMs: '5000',
      limit: '5',
    });
  });

  it('should handle API errors', async () => {
    vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse('Internal error', false, 500),
    );

    const result = await toolHandler({ action: 'discover', taskType: 'code-review' });
    expect(result.isError).toBe(true);
  });

  it('should handle network errors', async () => {
    vi.spyOn(transport, 'discover').mockRejectedValue(new Error('Connection refused'));

    const result = await toolHandler({ action: 'discover', taskType: 'code-review' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
  });

  it('should handle unknown action', async () => {
    const result = await toolHandler({ action: 'unknown' as any });
    expect(result.isError).toBe(true);
  });

  it('should handle multiple results', async () => {
    vi.spyOn(transport, 'discover').mockResolvedValue(
      mockResponse({
        results: [
          { anonymousAgentId: 'a1', taskType: 'summarization', trustScorePercentile: 90, provisional: false, qualityMetrics: {} },
          { anonymousAgentId: 'a2', taskType: 'summarization', trustScorePercentile: 75, provisional: true, qualityMetrics: {} },
        ],
      }),
    );

    const result = await toolHandler({ action: 'discover', taskType: 'summarization' });
    expect(result.content[0].text).toContain('Found 2 agent');
    expect(result.content[0].text).toContain('a1');
    expect(result.content[0].text).toContain('a2');
  });
});
