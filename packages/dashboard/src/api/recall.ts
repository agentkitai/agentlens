import { request, toQueryString } from './core';

export interface RecallResultItem {
  sourceType: string;
  sourceId: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface RecallResult {
  results: RecallResultItem[];
  query: string;
  totalResults: number;
}

export async function recall(params: {
  query: string;
  scope?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  minScore?: number;
}): Promise<RecallResult> {
  const qs = toQueryString({
    query: params.query,
    scope: params.scope,
    agentId: params.agentId,
    from: params.from,
    to: params.to,
    limit: params.limit,
    minScore: params.minScore,
  });
  return request<RecallResult>(`/api/recall${qs}`);
}
