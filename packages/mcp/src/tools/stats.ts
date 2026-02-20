/**
 * agentlens_stats MCP Tool (Feature 10, Story 10.12)
 *
 * Storage stats and overview metrics.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerStatsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_stats',
    `Get storage statistics and system overview metrics.

**When to use:** To check database/storage utilization or get a high-level system overview.

**Actions:**
- \`storage\`: Get storage stats (database size, event counts, etc.)
- \`overview\`: Get overview metrics (active sessions, agents, recent activity)

**Example:** agentlens_stats({ action: "storage" })`,
    {
      action: z.enum(['storage', 'overview']).describe('Action to perform'),
    },
    async (params) => {
      try {
        let response: Response;
        switch (params.action) {
          case 'storage': response = await transport.getStats(); break;
          case 'overview': response = await transport.getStatsOverview(); break;
          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`${response.status}: ${body}`);
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
      } catch (error) {
        return formatApiError(error, 'stats');
      }
    },
  );
}
