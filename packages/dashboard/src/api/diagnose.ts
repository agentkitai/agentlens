import { request, toQueryString } from './core';

// ─── Types (mirroring server-side diagnostics/types.ts) ─────────

export interface Evidence {
  type: 'error_pattern' | 'tool_sequence' | 'metric' | 'trend' | 'event';
  summary: string;
  data?: Record<string, unknown>;
}

export interface RootCause {
  description: string;
  confidence: number;
  category:
    | 'error_pattern'
    | 'tool_failure'
    | 'cost_anomaly'
    | 'performance_degradation'
    | 'configuration'
    | 'external';
  evidence: Evidence[];
}

export interface Recommendation {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface DiagnosticReport {
  id: string;
  type: 'agent' | 'session';
  targetId: string;
  severity: 'critical' | 'warning' | 'info' | 'healthy';
  summary: string;
  rootCauses: RootCause[];
  recommendations: Recommendation[];
  healthScore?: number;
  analysisContext: {
    windowDays?: number;
    sessionCount: number;
    dataPoints: number;
  };
  llmMeta: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    latencyMs: number;
  };
  createdAt: string;
  expiresAt: string;
  source: 'llm' | 'fallback';
}

// ─── API Functions ──────────────────────────────────────────────

export async function diagnoseAgent(
  agentId: string,
  window?: number,
  refresh?: boolean,
): Promise<DiagnosticReport> {
  const qs = toQueryString({ window, refresh });
  return request<DiagnosticReport>(
    `/api/agents/${encodeURIComponent(agentId)}/diagnose${qs}`,
    { method: 'POST' },
  );
}

export async function diagnoseSession(
  sessionId: string,
  refresh?: boolean,
): Promise<DiagnosticReport> {
  const qs = toQueryString({ refresh });
  return request<DiagnosticReport>(
    `/api/sessions/${encodeURIComponent(sessionId)}/diagnose${qs}`,
    { method: 'POST' },
  );
}
