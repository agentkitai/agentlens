import { request, toQueryString } from './core';

export type ReflectAnalysis =
  | 'error_patterns'
  | 'tool_sequences'
  | 'cost_analysis'
  | 'performance_trends';

export interface ReflectInsight {
  type: string;
  summary: string;
  data: Record<string, unknown>;
  confidence: number;
}

export interface ReflectResultData {
  analysis: ReflectAnalysis;
  insights: ReflectInsight[];
  metadata: {
    sessionsAnalyzed: number;
    eventsAnalyzed: number;
    timeRange: { from: string; to: string };
  };
}

export async function reflect(params: {
  analysis: ReflectAnalysis;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<ReflectResultData> {
  const qs = toQueryString({
    analysis: params.analysis,
    agentId: params.agentId,
    from: params.from,
    to: params.to,
    limit: params.limit,
  });
  return request<ReflectResultData>(`/api/reflect${qs}`);
}
