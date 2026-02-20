/**
 * agentlens_sessions MCP Tool (Feature 10, Story 10.6)
 *
 * Browse and inspect sessions: list, detail, timeline.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerSessionsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_sessions',
    `Browse and inspect AgentLens sessions.

**When to use:** To find past sessions, inspect session details, or view a timeline of events within a session. Useful for debugging, auditing, or reviewing agent activity.

**Actions:**
- \`list\`: List sessions with optional filters (agentId, status, date range, tags)
- \`detail\`: Get full session detail with aggregates
- \`timeline\`: Get timestamped event list for a session

**Example:** agentlens_sessions({ action: "list", agentId: "my-agent", status: "completed", limit: 10 })`,
    {
      action: z.enum(['list', 'detail', 'timeline']).describe('Action to perform'),
      sessionId: z.string().optional().describe('Session ID (required for detail/timeline)'),
      agentId: z.string().optional().describe('Filter by agent ID (list)'),
      status: z.string().optional().describe('Filter by status: active, completed, error (list)'),
      from: z.string().optional().describe('Start date ISO (list)'),
      to: z.string().optional().describe('End date ISO (list)'),
      tags: z.array(z.string()).optional().describe('Filter by tags (list)'),
      limit: z.number().optional().describe('Max results, default 20 (list)'),
      offset: z.number().optional().describe('Pagination offset (list)'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const qp: Record<string, string> = {};
            if (params.agentId) qp.agentId = params.agentId;
            if (params.status) qp.status = params.status;
            if (params.from) qp.from = params.from;
            if (params.to) qp.to = params.to;
            if (params.tags) qp.tags = params.tags.join(',');
            if (params.limit !== undefined) qp.limit = String(params.limit);
            if (params.offset !== undefined) qp.offset = String(params.offset);

            const response = await transport.listSessions(qp);
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            const data = await response.json();
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          case 'detail': {
            if (!params.sessionId) {
              return { content: [{ type: 'text' as const, text: 'Validation error: "sessionId" is required for detail action.' }], isError: true };
            }
            const response = await transport.getSession(params.sessionId);
            if (!response.ok) {
              const body = await response.text().catch(() => '');
              throw new Error(`${response.status}: ${body}`);
            }
            const data = await response.json();
            return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
          }

          case 'timeline': {
            if (!params.sessionId) {
              return { content: [{ type: 'text' as const, text: 'Validation error: "sessionId" is required for timeline action.' }], isError: true };
            }
            const response = await transport.getSessionTimeline(params.sessionId);
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
        return formatApiError(error, 'sessions');
      }
    },
  );
}
