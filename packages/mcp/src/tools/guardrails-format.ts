/**
 * Guardrail formatting utilities for MCP tool output.
 */

interface GuardrailRuleInfo {
  id: string;
  name: string;
  enabled: boolean;
  conditionType: string;
  actionType: string;
  cooldownMinutes: number;
  dryRun: boolean;
}

interface GuardrailStatusInfo {
  rule: GuardrailRuleInfo;
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

export function formatGuardrailStatus(rules: GuardrailRuleInfo[], statuses: GuardrailStatusInfo[]): string {
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
