/**
 * Diagnostic Types (Story 18.1)
 *
 * Core type definitions for the AI-powered diagnostics module.
 */

/** Request to run diagnostics */
export interface DiagnosticRequest {
  type: 'agent' | 'session';
  agentId?: string;
  sessionId?: string;
  windowDays?: number;
  refresh?: boolean;
}

/** Evidence supporting a root cause */
export interface Evidence {
  type: 'error_pattern' | 'tool_sequence' | 'metric' | 'trend' | 'event';
  summary: string;
  data?: Record<string, unknown>;
}

/** A single identified root cause */
export interface RootCause {
  description: string;
  confidence: number; // 0.0–1.0
  category:
    | 'error_pattern'
    | 'tool_failure'
    | 'cost_anomaly'
    | 'performance_degradation'
    | 'configuration'
    | 'external';
  evidence: Evidence[];
}

/** Actionable recommendation */
export interface Recommendation {
  action: string;
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

/** Complete diagnostic report */
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
