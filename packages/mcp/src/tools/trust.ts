/**
 * agentlens_trust MCP Tool (Feature 10, Story 10.13)
 *
 * Get trust scores for agents.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerTrustTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_trust',
    `Get trust scores for agents.

**When to use:** To check the trust/reliability score of an agent before delegating tasks or to monitor agent reputation.

**Actions:**
- \`score\`: Get trust score for a specific agent

**Example:** agentlens_trust({ action: "score", agentId: "my-agent" })`,
    {
      action: z.enum(['score']).describe('Action to perform'),
      agentId: z.string().optional().describe('Agent ID (required for score)'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'score': {
            if (!params.agentId) {
              return { content: [{ type: 'text' as const, text: 'Validation error: "agentId" is required for score action.' }], isError: true };
            }
            const response = await transport.getTrustScore(params.agentId);
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }
      } catch (error) {
        return formatApiError(error, 'trust');
      }
    },
  );
}
