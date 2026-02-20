/**
 * agentlens_cost_budgets MCP Tool (Feature 10, Story 10.10)
 *
 * Budget CRUD, status check, and anomaly detection configuration.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';
import { formatApiError } from './error-helpers.js';

export function registerCostBudgetsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_cost_budgets',
    `Manage cost budgets and anomaly detection.

**When to use:** To create/manage spending limits, check budget utilization, or configure cost anomaly detection.

**Actions:**
- \`list\`: List all cost budgets
- \`create\`: Create a new budget
- \`update\`: Update an existing budget
- \`delete\`: Delete a budget
- \`status\`: Check spend vs limit for a budget
- \`anomaly_config\`: Get anomaly detection configuration
- \`anomaly_update\`: Update anomaly detection settings

**Example:** agentlens_cost_budgets({ action: "create", scope: "global", period: "daily", limitUsd: 10, onBreach: "alert" })`,
    {
      action: z.enum(['list', 'create', 'update', 'delete', 'status', 'anomaly_config', 'anomaly_update']).describe('Action to perform'),
      budgetId: z.string().optional().describe('Budget ID (required for update/delete/status)'),
      scope: z.enum(['global', 'agent']).optional().describe('Budget scope'),
      agentId: z.string().optional().describe('Agent ID (for agent-scoped budgets)'),
      period: z.enum(['daily', 'weekly', 'monthly']).optional().describe('Budget period'),
      limitUsd: z.number().optional().describe('Spending limit in USD'),
      onBreach: z.enum(['alert', 'pause', 'downgrade']).optional().describe('Action on budget breach'),
      downgradeTargetModel: z.string().optional().describe('Target model for downgrade action'),
      enabled: z.boolean().optional().describe('Enable/disable budget'),
      zScoreThreshold: z.number().optional().describe('Z-score threshold for anomaly detection'),
      lookbackDays: z.number().optional().describe('Lookback period in days for anomaly detection'),
    },
    async (params) => {
      try {
        switch (params.action) {
          case 'list': {
            const qp: Record<string, string> = {};
            if (params.agentId) qp.agentId = params.agentId;
            if (params.scope) qp.scope = params.scope;
            const response = await transport.listCostBudgets(qp);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'create': {
            if (!params.scope) return { content: [{ type: 'text' as const, text: 'Validation error: "scope" is required for create action.' }], isError: true };
            if (!params.period) return { content: [{ type: 'text' as const, text: 'Validation error: "period" is required for create action.' }], isError: true };
            if (params.limitUsd === undefined) return { content: [{ type: 'text' as const, text: 'Validation error: "limitUsd" is required for create action.' }], isError: true };
            if (!params.onBreach) return { content: [{ type: 'text' as const, text: 'Validation error: "onBreach" is required for create action.' }], isError: true };

            const body: Record<string, unknown> = {
              scope: params.scope, period: params.period, limitUsd: params.limitUsd, onBreach: params.onBreach,
            };
            if (params.agentId) body.agentId = params.agentId;
            if (params.downgradeTargetModel) body.downgradeTargetModel = params.downgradeTargetModel;
            if (params.enabled !== undefined) body.enabled = params.enabled;

            const response = await transport.createCostBudget(body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'update': {
            if (!params.budgetId) return { content: [{ type: 'text' as const, text: 'Validation error: "budgetId" is required for update action.' }], isError: true };
            const body: Record<string, unknown> = {};
            if (params.limitUsd !== undefined) body.limitUsd = params.limitUsd;
            if (params.onBreach) body.onBreach = params.onBreach;
            if (params.enabled !== undefined) body.enabled = params.enabled;
            if (params.downgradeTargetModel) body.downgradeTargetModel = params.downgradeTargetModel;

            const response = await transport.updateCostBudget(params.budgetId, body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'delete': {
            if (!params.budgetId) return { content: [{ type: 'text' as const, text: 'Validation error: "budgetId" is required for delete action.' }], isError: true };
            const response = await transport.deleteCostBudget(params.budgetId);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: `Budget ${params.budgetId} deleted.` }] };
          }

          case 'status': {
            if (!params.budgetId) return { content: [{ type: 'text' as const, text: 'Validation error: "budgetId" is required for status action.' }], isError: true };
            const response = await transport.getCostBudgetStatus(params.budgetId);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'anomaly_config': {
            const response = await transport.getAnomalyConfig();
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          case 'anomaly_update': {
            const body: Record<string, unknown> = {};
            if (params.zScoreThreshold !== undefined) body.zScoreThreshold = params.zScoreThreshold;
            if (params.lookbackDays !== undefined) body.lookbackDays = params.lookbackDays;

            const response = await transport.updateAnomalyConfig(body);
            if (!response.ok) { const b = await response.text().catch(() => ''); throw new Error(`${response.status}: ${b}`); }
            return { content: [{ type: 'text' as const, text: JSON.stringify(await response.json(), null, 2) }] };
          }

          default:
            return { content: [{ type: 'text' as const, text: `Unknown action: ${params.action as string}` }], isError: true };
        }
      } catch (error) {
        return formatApiError(error, 'cost-budgets');
      }
    },
  );
}
