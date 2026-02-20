/**
 * Diagnostic Prompt Templates (Story 18.5)
 */

import type { AgentDiagnosticContext, SessionDiagnosticContext } from './context-builder.js';

const SYSTEM_PROMPT = `You are an AI agent diagnostics expert for AgentLens, an observability platform for AI agents. You analyze health metrics, error patterns, tool usage sequences, cost data, and performance trends to identify root causes of agent failures and degradation.

You MUST respond with valid JSON matching the provided schema. Be specific and evidence-based — every root cause must cite concrete data points. Do not speculate beyond the provided data.

Severity levels:
- critical: Agent is failing (health < 40, high error rate, or critical errors)
- warning: Agent is degrading (health 40-70, rising errors, or cost anomalies)
- info: Minor issues detected (health 70-85, minor patterns)
- healthy: No significant issues (health > 85)`;

/**
 * JSON schema for structured output (used with OpenAI response_format and Anthropic tool-use).
 */
export const DIAGNOSTIC_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['critical', 'warning', 'info', 'healthy'] },
    summary: { type: 'string', maxLength: 500 },
    rootCauses: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          category: {
            type: 'string',
            enum: [
              'error_pattern', 'tool_failure', 'cost_anomaly',
              'performance_degradation', 'configuration', 'external',
            ],
          },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                summary: { type: 'string' },
              },
              required: ['type', 'summary'],
            },
          },
        },
        required: ['description', 'confidence', 'category', 'evidence'],
      },
    },
    recommendations: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          rationale: { type: 'string' },
        },
        required: ['action', 'priority', 'rationale'],
      },
    },
  },
  required: ['severity', 'summary', 'rootCauses', 'recommendations'],
};

export const CORRECTION_PROMPT =
  'Your previous response was not valid JSON matching the required schema. Please respond ONLY with valid JSON matching the schema. Do not include any text outside the JSON object.';

export function buildAgentDiagnosticPrompt(
  context: AgentDiagnosticContext,
): { system: string; user: string } {
  const { health, errorPatterns, toolSequences, costAnalysis, performanceTrends } = context;

  const dims = health.dimensions
    .map((d) => `- ${d.name}: ${d.score}/100 — ${d.description}`)
    .join('\n');

  const errors = errorPatterns.insights.length > 0
    ? errorPatterns.insights.map((i, idx) => `  ${idx + 1}. ${i.summary}`).join('\n')
    : '  None found';

  const tools = toolSequences.insights.length > 0
    ? toolSequences.insights.map((i, idx) => `  ${idx + 1}. ${i.summary}`).join('\n')
    : '  None found';

  const costs = costAnalysis.insights.map((i) => `  - ${i.summary}`).join('\n') || '  No data';

  const perf = performanceTrends.insights.map((i) => `  - ${i.summary}`).join('\n') || '  No data';

  const user = `## Agent: ${context.agentId}
## Window: ${context.windowDays} days

### Health Score: ${health.overallScore}/100 (trend: ${health.trend}, delta: ${health.trendDelta})
Dimensions:
${dims}

### Error Patterns (${errorPatterns.insights.length} patterns found):
${errors}

### Tool Sequences (${toolSequences.insights.length} sequences):
${tools}

### Cost Analysis:
${costs}

### Performance Trends:
${perf}

Analyze the above data and produce a diagnostic report.`;

  return { system: SYSTEM_PROMPT, user };
}

export function buildSessionDiagnosticPrompt(
  context: SessionDiagnosticContext,
): { system: string; user: string } {
  const { session, timeline, errorEvents, toolCallChain, costBreakdown } = context;

  const totalCost = costBreakdown.reduce((sum, c) => sum + c.cost, 0);
  const timelineStr = timeline.slice(-50).map((e) => {
    const payload = e.payload as Record<string, unknown>;
    const msg = payload.message ?? payload.toolName ?? payload.name ?? '';
    return `  [${e.timestamp}] ${e.eventType}: ${msg}`;
  }).join('\n');

  const errorsStr = errorEvents.length > 0
    ? errorEvents.map((e) => {
        const p = e.payload as Record<string, unknown>;
        return `  - ${p.message ?? 'Unknown error'}`;
      }).join('\n')
    : '  None';

  const toolChainStr = toolCallChain.length > 0
    ? toolCallChain
        .map((t) => `  ${t.tool} → ${t.success ? 'OK' : 'FAIL'}${t.duration ? ` (${t.duration}ms)` : ''}`)
        .join('\n')
    : '  No tool calls';

  const costStr = costBreakdown.length > 0
    ? costBreakdown.map((c) => `  - ${c.model}: $${c.cost.toFixed(4)} (${c.tokens} tokens)`).join('\n')
    : '  No cost data';

  const user = `## Session: ${context.sessionId}
## Agent: ${session.agentId}
## Status: ${session.status} | Duration: ${session.endedAt ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime() : 'ongoing'}ms | Errors: ${session.errorCount}

### Timeline (${timeline.length} events, showing last 50):
${timelineStr}

### Error Events:
${errorsStr}

### Tool Call Chain:
${toolChainStr}

### Cost: $${totalCost.toFixed(4)} across ${costBreakdown.length} models
${costStr}

Analyze this session and identify why it ${session.status === 'failed' ? 'failed' : 'had errors/degraded'}.`;

  return { system: SYSTEM_PROMPT, user };
}
