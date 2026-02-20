/**
 * Diagnostic Context Builders (Stories 18.3, 18.4)
 *
 * Collects and sanitizes data for LLM-powered diagnostics.
 */

import type {
  IEventStore,
  HealthScore,
  ReflectResult,
  Session,
  AgentLensEvent,
} from '@agentlensai/core';
import { HealthComputer } from '../health/computer.js';
import { DEFAULT_HEALTH_WEIGHTS } from '@agentlensai/core';
import { runAnalysis } from '../analysis/index.js';
import { sanitizeForLLM } from '../error-sanitizer.js';

// ─── Agent-Level Context (Story 18.3) ────────────────────

export interface AgentDiagnosticContext {
  agentId: string;
  windowDays: number;
  health: HealthScore;
  errorPatterns: ReflectResult;
  toolSequences: ReflectResult;
  costAnalysis: ReflectResult;
  performanceTrends: ReflectResult;
}

/**
 * Build agent-level diagnostic context.
 * Collects health + 4 analyses in parallel, applies sanitization and limits.
 */
export async function buildAgentContext(
  store: IEventStore,
  agentId: string,
  windowDays: number,
): Promise<AgentDiagnosticContext> {
  const now = new Date();
  const from = new Date(now.getTime() - windowDays * 86400000).toISOString();
  const to = now.toISOString();

  const computer = new HealthComputer(DEFAULT_HEALTH_WEIGHTS);
  const analysisOpts = { agentId, from, to };

  const [health, errorPatterns, toolSequences, costAnalysis, performanceTrends] =
    await Promise.all([
      computer.compute(store, agentId, windowDays),
      runAnalysis('error_patterns', store, analysisOpts),
      runAnalysis('tool_sequences', store, analysisOpts),
      runAnalysis('cost_analysis', store, analysisOpts),
      runAnalysis('performance_trends', store, analysisOpts),
    ]);

  if (!health) {
    throw Object.assign(new Error('No session data for agent in the specified window'), {
      status: 404,
    });
  }

  // Apply limits (architecture §6.4)
  const limitInsights = (result: ReflectResult, max: number): ReflectResult => ({
    ...result,
    insights: result.insights.slice(0, max).map((insight) => ({
      ...insight,
      summary: sanitizeForLLM(insight.summary),
      data: truncateData(insight.data),
    })),
  });

  return {
    agentId,
    windowDays,
    health,
    errorPatterns: limitInsights(errorPatterns, 10),
    toolSequences: limitInsights(toolSequences, 10),
    costAnalysis: limitInsights(costAnalysis, 10),
    performanceTrends: limitInsights(performanceTrends, 10),
  };
}

// ─── Session-Level Context (Story 18.4) ──────────────────

export interface SessionDiagnosticContext {
  sessionId: string;
  session: Session;
  timeline: AgentLensEvent[];
  errorEvents: AgentLensEvent[];
  toolCallChain: Array<{ tool: string; success: boolean; duration?: number }>;
  costBreakdown: Array<{ model: string; cost: number; tokens: number }>;
}

/**
 * Build session-level diagnostic context.
 */
export async function buildSessionContext(
  store: IEventStore,
  sessionId: string,
): Promise<SessionDiagnosticContext> {
  const session = await store.getSession(sessionId);
  if (!session) {
    throw Object.assign(new Error('Session not found'), { status: 404 });
  }

  let timeline = await store.getSessionTimeline(sessionId);

  // Limit to last 200 events
  if (timeline.length > 200) {
    timeline = timeline.slice(-200);
  }

  // Extract error events
  const errorEvents = timeline.filter(
    (e) => e.eventType === 'error' || e.eventType === 'tool_error',
  );

  // Build tool call chain
  const toolCallChain: SessionDiagnosticContext['toolCallChain'] = [];
  for (const event of timeline) {
    if (event.eventType === 'tool_call') {
      const payload = event.payload as Record<string, unknown>;
      toolCallChain.push({
        tool: (payload.toolName as string) ?? (payload.name as string) ?? 'unknown',
        success: true, // updated by subsequent response/error
        duration: undefined,
      });
    } else if (event.eventType === 'tool_response' || event.eventType === 'tool_error') {
      const last = toolCallChain[toolCallChain.length - 1];
      if (last) {
        const payload = event.payload as Record<string, unknown>;
        last.success = event.eventType === 'tool_response' && payload.isError !== true;
        if (payload.durationMs) last.duration = payload.durationMs as number;
      }
    }
  }

  // Build cost breakdown from llm_response events
  const costMap = new Map<string, { cost: number; tokens: number }>();
  for (const event of timeline) {
    if (event.eventType === 'llm_response') {
      const payload = event.payload as Record<string, unknown>;
      const model = (payload.model as string) ?? 'unknown';
      const cost = (payload.costUsd as number) ?? 0;
      const tokens =
        ((payload.inputTokens as number) ?? 0) + ((payload.outputTokens as number) ?? 0);
      const existing = costMap.get(model) ?? { cost: 0, tokens: 0 };
      costMap.set(model, { cost: existing.cost + cost, tokens: existing.tokens + tokens });
    }
  }

  // Sanitize error messages in timeline
  const sanitizedTimeline = timeline.map((e) => {
    if (e.eventType === 'error' || e.eventType === 'tool_error') {
      const payload = e.payload as Record<string, unknown>;
      if (payload.message && typeof payload.message === 'string') {
        return { ...e, payload: { ...payload, message: sanitizeForLLM(payload.message) } } as typeof e;
      }
    }
    return e;
  });

  return {
    sessionId,
    session,
    timeline: sanitizedTimeline,
    errorEvents,
    toolCallChain,
    costBreakdown: Array.from(costMap.entries()).map(([model, data]) => ({
      model,
      ...data,
    })),
  };
}

// ─── Helpers ─────────────────────────────────────────────

/** Truncate data blob values to 500 chars */
function truncateData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 500) {
      result[key] = value.slice(0, 497) + '...';
    } else {
      result[key] = value;
    }
  }
  return result;
}
