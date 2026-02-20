/**
 * Tests for agentlens_cost_budgets MCP Tool (Feature 10, Story 10.10)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AgentLensTransport } from '../../transport.js';
import { registerCostBudgetsTool } from '../cost-budgets.js';

function mockResponse(data: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) } as Response;
}

describe('agentlens_cost_budgets', () => {
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
    registerCostBudgetsTool(server, transport);
  });

  it('lists budgets', async () => {
    vi.spyOn(transport, 'listCostBudgets').mockResolvedValue(mockResponse({ budgets: [] }));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBeUndefined();
  });

  it('creates budget', async () => {
    vi.spyOn(transport, 'createCostBudget').mockResolvedValue(mockResponse({ id: 'b1' }));
    const result = await toolHandler({ action: 'create', scope: 'global', period: 'daily', limitUsd: 10, onBreach: 'alert' });
    expect(result.isError).toBeUndefined();
  });

  it('validates create requires scope', async () => {
    const result = await toolHandler({ action: 'create', period: 'daily', limitUsd: 10, onBreach: 'alert' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('scope');
  });

  it('validates create requires period', async () => {
    const result = await toolHandler({ action: 'create', scope: 'global', limitUsd: 10, onBreach: 'alert' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('period');
  });

  it('validates create requires limitUsd', async () => {
    const result = await toolHandler({ action: 'create', scope: 'global', period: 'daily', onBreach: 'alert' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('limitUsd');
  });

  it('validates create requires onBreach', async () => {
    const result = await toolHandler({ action: 'create', scope: 'global', period: 'daily', limitUsd: 10 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('onBreach');
  });

  it('gets budget status', async () => {
    vi.spyOn(transport, 'getCostBudgetStatus').mockResolvedValue(mockResponse({ spend: 5, limit: 10 }));
    const result = await toolHandler({ action: 'status', budgetId: 'b1' });
    expect(result.isError).toBeUndefined();
  });

  it('validates status requires budgetId', async () => {
    const result = await toolHandler({ action: 'status' });
    expect(result.isError).toBe(true);
  });

  it('deletes budget', async () => {
    vi.spyOn(transport, 'deleteCostBudget').mockResolvedValue(mockResponse(null));
    const result = await toolHandler({ action: 'delete', budgetId: 'b1' });
    expect(result.isError).toBeUndefined();
  });

  it('gets anomaly config', async () => {
    vi.spyOn(transport, 'getAnomalyConfig').mockResolvedValue(mockResponse({ zScoreThreshold: 2 }));
    const result = await toolHandler({ action: 'anomaly_config' });
    expect(result.isError).toBeUndefined();
  });

  it('updates anomaly config', async () => {
    vi.spyOn(transport, 'updateAnomalyConfig').mockResolvedValue(mockResponse({ ok: true }));
    const result = await toolHandler({ action: 'anomaly_update', zScoreThreshold: 2.5 });
    expect(result.isError).toBeUndefined();
    expect(transport.updateAnomalyConfig).toHaveBeenCalledWith({ zScoreThreshold: 2.5 });
  });

  it('handles 404', async () => {
    vi.spyOn(transport, 'listCostBudgets').mockResolvedValue(mockResponse('Not found', false, 404));
    const result = await toolHandler({ action: 'list' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('newer AgentLens server version');
  });
});
