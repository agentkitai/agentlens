/**
 * agentlens_analytics MCP Tool (Feature 10, Story 10.9)
 *
 * Query operational metrics, costs, agent metrics, and tool usage stats.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerAnalyticsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_analytics',
    `Query operational analytics: metrics, costs, agent performance, and tool usage.

**When to use:** To understand system performance trends, cost breakdowns, agent activity, or tool usage patterns over time.

**Actions:**
- \`metrics\`: Get bucketed metrics with optional range/date filters
- \`costs\`: Get cost breakdown
- \`agents\`: Get per-agent metrics
- \`tools\`: Get tool usage statistics

**Example:** agentlens_analytics({ action: "metrics", range: "24h" })`,
    {
      action: z.enum(['metrics', 'costs', 'agents', 'tools']).describe('Action to perform'),
      range: z.string().optional().describe('Shorthand: 1h, 6h, 24h, 3d, 7d, 30d'),
      from: z.string().optional().describe('Start date ISO'),
      to: z.string().optional().describe('End date ISO'),
      granularity: z.enum(['hour', 'day', 'week']).optional().describe('Bucket granularity'),
      agentId: z.string().optional().describe('Filter by agent ID'),
    },
    async (params) => {
      try {
        const qp: Record<string, string> = {};
        if (params.range) qp.range = params.range;
        if (params.from) qp.from = params.from;
        if (params.to) qp.to = params.to;
        if (params.granularity) qp.granularity = params.granularity;
        if (params.agentId) qp.agentId = params.agentId;

        let response: Response;
        switch (params.action) {
          case 'metrics': response = await transport.getAnalytics(qp); break;
          case 'costs': response = await transport.getAnalyticsCosts(qp); break;
          case 'agents': response = await transport.getAnalyticsAgents(qp); break;
          case 'tools': response = await transport.getAnalyticsTools(qp); break;
          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`${response.status}: ${body}`);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
      } catch (error) {
        return formatApiError(error, 'analytics');
      }
    },
  );
}
