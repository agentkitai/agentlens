/**
 * agentlens_alerts MCP Tool (Feature 10, Story 10.8)
 *
 * Create, list, update, delete alert rules, and view alert history.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerAlertsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_alerts',
    `Manage alert rules and view alert history.

**When to use:** To create alerting rules for error rates, costs, or latency thresholds; manage existing rules; or review past alert triggers.

**Actions:**
- \`list\`: List all alert rules
- \`create\`: Create a new alert rule
- \`update\`: Update an existing alert rule
- \`delete\`: Delete an alert rule
- \`history\`: View recent alert triggers

**Example:** agentlens_alerts({ action: "create", name: "High error rate", condition: "error_rate_above", threshold: 0.1, windowMinutes: 60 })`,
    {
      action: z.enum(['list', 'create', 'update', 'delete', 'history']).describe('Action to perform'),
      ruleId: z.string().optional().describe('Rule ID (required for update/delete)'),
      name: z.string().optional().describe('Alert rule name (required for create)'),
      condition: z.string().optional().describe('Condition: error_rate_above, cost_above, latency_above (required for create)'),
      threshold: z.number().optional().describe('Threshold value (required for create)'),
      windowMinutes: z.number().optional().describe('Evaluation window in minutes (required for create)'),
      scope: z.string().optional().describe('Scope: global or agentId'),
      notifyChannels: z.array(z.string()).optional().describe('Notification channels'),
      enabled: z.boolean().optional().describe('Enable/disable rule'),
      limit: z.number().optional().describe('Max history results'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const response = await transport.listAlertRules();
            if (!response.ok) { const body = await response.text().catch(() => ''); throw new Error(`${response.status}: ${body}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'create': {
            if (!params.name) return { content: [{ type: 'text' as const, text: 'Validation error: "name" is required for create action.' }], isError: true };
            if (!params.condition) return { content: [{ type: 'text' as const, text: 'Validation error: "condition" is required for create action.' }], isError: true };
            if (params.threshold === undefined) return { content: [{ type: 'text' as const, text: 'Validation error: "threshold" is required for create action.' }], isError: true };

            const body: Record<string, unknown> = {
              name: params.name,
              condition: params.condition,
              threshold: params.threshold,
            };
            if (params.windowMinutes !== undefined) body.windowMinutes = params.windowMinutes;
            if (params.scope) body.scope = params.scope;
            if (params.notifyChannels) body.notifyChannels = params.notifyChannels;
            if (params.enabled !== undefined) body.enabled = params.enabled;

            const response = await transport.createAlertRule(body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'update': {
            if (!params.ruleId) return { content: [{ type: 'text' as const, text: 'Validation error: "ruleId" is required for update action.' }], isError: true };
            const body: Record<string, unknown> = {};
            if (params.name) body.name = params.name;
            if (params.condition) body.condition = params.condition;
            if (params.threshold !== undefined) body.threshold = params.threshold;
            if (params.windowMinutes !== undefined) body.windowMinutes = params.windowMinutes;
            if (params.scope) body.scope = params.scope;
            if (params.notifyChannels) body.notifyChannels = params.notifyChannels;
            if (params.enabled !== undefined) body.enabled = params.enabled;

            const response = await transport.updateAlertRule(params.ruleId, body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'delete': {
            if (!params.ruleId) return { content: [{ type: 'text' as const, text: 'Validation error: "ruleId" is required for delete action.' }], isError: true };
            const response = await transport.deleteAlertRule(params.ruleId);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: `Alert rule ${params.ruleId} deleted.` }] };
          }

          case 'history': {
            const qp: Record<string, string> = {};
            if (params.limit !== undefined) qp.limit = String(params.limit);
            if (params.ruleId) qp.ruleId = params.ruleId;
            const response = await transport.getAlertHistory(qp);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }
      } catch (error) {
        return formatApiError(error, 'alerts');
      }
    },
  );
}
