/**
 * agentlens_agents MCP Tool (Feature 10, Story 10.7)
 *
 * List, inspect, and manage agents.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerAgentsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_agents',
    `List, inspect, and manage AgentLens agents.

**When to use:** To see which agents are registered, check agent details and error rates, or unpause a paused agent.

**Actions:**
- \`list\`: List all agents with error rates
- \`detail\`: Get agent detail by ID
- \`unpause\`: Clear paused state for an agent

**Example:** agentlens_agents({ action: "list" })`,
    {
      action: z.enum(['list', 'detail', 'unpause']).describe('Action to perform'),
      agentId: z.string().optional().describe('Agent ID (required for detail/unpause)'),
      clearModelOverride: z.boolean().optional().describe('Clear model override on unpause'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const response = await transport.listAgents();
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            const data = await response.json();
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          case 'detail': {
            if (!params.agentId) {
              return { content: [{ type: 'text' as const, text: 'Validation error: "agentId" is required for detail action.' }], isError: true };
            }
            const response = await transport.getAgent(params.agentId);
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            const data = await response.json();
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          case 'unpause': {
            if (!params.agentId) {
              return { content: [{ type: 'text' as const, text: 'Validation error: "agentId" is required for unpause action.' }], isError: true };
            }
            const response = await transport.unpauseAgent(params.agentId, params.clearModelOverride);
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            const data = await response.json();
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }
      } catch (error) {
        return formatApiError(error, 'agents');
      }
    },
  );
}
