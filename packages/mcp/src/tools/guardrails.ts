/**
 * agentlens_guardrails MCP Tool (v0.8.0 — Story 3.1)
 *
 * Check guardrail status for the current agent.
 * Returns active rules, their status, and recent triggers.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentLensTransport } from '../transport.js';

interface GuardrailRuleResponse {
  id: string;
  name: string;
  enabled: boolean;
  conditionType: string;
  actionType: string;
  cooldownMinutes: number;
  dryRun: boolean;
}

interface GuardrailStatusResponse {
  rule: GuardrailRuleResponse;
  state: {
    lastTriggeredAt?: string;
    triggerCount: number;
    lastEvaluatedAt?: string;
    currentValue?: number;
  } | null;
  recentTriggers: Array<{
    triggeredAt: string;
    conditionValue: number;
    conditionThreshold: number;
    actionResult?: string;
  }>;
}

function formatGuardrailStatus(rules: GuardrailRuleResponse[], statuses: GuardrailStatusResponse[]): string {
  if (rules.length === 0) {
    return 'No guardrail rules configured. Create rules via the REST API or dashboard.';
  }

  const parts: string[] = [];
  parts.push(`Guardrails: ${rules.length} rule(s) configured\n`);

  for (const status of statuses) {
    const rule = status.rule;
    const state = status.state;
    const enabled = rule.enabled ? '✅ Enabled' : '❌ Disabled';
    const dryRun = rule.dryRun ? ' [DRY RUN]' : '';
    const triggerCount = state?.triggerCount ?? 0;
    const lastTriggered = state?.lastTriggeredAt ? ` (last: ${state.lastTriggeredAt.slice(0, 19)})` : '';

    parts.push(`${enabled}${dryRun} ${rule.name}`);
    parts.push(`  Condition: ${rule.conditionType} → Action: ${rule.actionType}`);
    parts.push(`  Triggers: ${triggerCount}${lastTriggered}`);

    if (status.recentTriggers.length > 0) {
      parts.push(`  Recent:`);
      for (const t of status.recentTriggers.slice(0, 3)) {
        parts.push(`    ${t.triggeredAt.slice(0, 19)}: value=${t.conditionValue} threshold=${t.conditionThreshold} → ${t.actionResult ?? 'unknown'}`);
      }
    }
    parts.push('');
  }

  return parts.join('\n');
}

export function registerGuardrailsTool(server: McpServer, transport: AgentLensTransport): void {
  server.tool(
    'agentlens_guardrails',
    `Check guardrail status for the current agent. Returns active guardrail rules, their current state, and recent trigger history.

**When to use:** To check what guardrails are protecting this agent, whether any have been triggered recently, and what conditions/actions are configured.

**What it returns:** A list of configured guardrail rules with their status (enabled/disabled, trigger count, last trigger time) and recent trigger history.

**Example:** agentlens_guardrails({}) → returns all guardrail rules and their status.`,
    {
      agentId: z
        .string()
        .optional()
        .describe('Agent ID to check guardrails for (defaults to current agent)'),
    },
    async ({ agentId }) => {
      try {
        const effectiveAgentId = agentId ?? transport.getFirstActiveAgent();

        if (!effectiveAgentId) {
          return {
            content: [{
              type: 'text' as const,
              text: 'No active session found. Start a session with agentlens_session_start first.',
            }],
            isError: true,
          };
        }

        // Fetch guardrail rules
        const rulesResponse = await transport.getGuardrailRules() as { rules: GuardrailRuleResponse[] };
        const rules = rulesResponse.rules || [];

        // Fetch status for each rule
        const statuses: GuardrailStatusResponse[] = [];
        for (const rule of rules) {
          try {
            const status = await transport.getGuardrailStatus(rule.id) as GuardrailStatusResponse;
            statuses.push(status);
          } catch {
            statuses.push({ rule, state: null, recentTriggers: [] });
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: formatGuardrailStatus(rules, statuses),
          }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{
            type: 'text' as const,
            text: `Error checking guardrails: ${message}`,
          }],
          isError: true,
        };
      }
    },
  );
}
