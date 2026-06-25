import { request, toQueryString, ApiError } from './core';
import type { EvalDataset, EvalTestCase, EvalInput, ScorerConfig, EvaluatorDefinition, ScorerType } from '@agentlensai/core';

// Re-export for convenience
export type { EvalDataset, EvalTestCase, EvaluatorDefinition, ScorerType };

export interface EvalDatasetListResponse {
  datasets: EvalDataset[];
  total: number;
  hasMore: boolean;
}

export interface EvalDatasetDetailResponse extends EvalDataset {
  testCases: EvalTestCase[];
}

export async function getEvalDatasets(params?: {
  agentId?: string;
  limit?: number;
  offset?: number;
}): Promise<EvalDatasetListResponse> {
  const qs = toQueryString({
    agentId: params?.agentId,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request<EvalDatasetListResponse>(`/api/eval/datasets${qs}`);
}

export async function getEvalDataset(id: string): Promise<EvalDatasetDetailResponse> {
  return request<EvalDatasetDetailResponse>(`/api/eval/datasets/${encodeURIComponent(id)}`);
}

export async function createEvalDataset(data: {
  name: string;
  description?: string;
  agentId?: string;
  testCases?: Array<{
    input: EvalInput;
    expectedOutput?: unknown;
    tags?: string[];
    scoringCriteria?: string;
  }>;
}): Promise<EvalDataset> {
  return request<EvalDataset>('/api/eval/datasets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateEvalDataset(
  id: string,
  data: { name?: string; description?: string },
): Promise<EvalDataset> {
  return request<EvalDataset>(`/api/eval/datasets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function addTestCase(
  datasetId: string,
  testCase: {
    input: EvalInput;
    expectedOutput?: unknown;
    tags?: string[];
    scoringCriteria?: string;
  },
): Promise<EvalTestCase> {
  return request<EvalTestCase>(
    `/api/eval/datasets/${encodeURIComponent(datasetId)}/cases`,
    {
      method: 'POST',
      body: JSON.stringify(testCase),
    },
  );
}

export async function updateTestCase(
  datasetId: string,
  caseId: string,
  data: {
    input?: EvalInput;
    expectedOutput?: unknown;
    tags?: string[];
    scoringCriteria?: string;
  },
): Promise<EvalTestCase> {
  return request<EvalTestCase>(
    `/api/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(data),
    },
  );
}

export async function deleteTestCase(
  datasetId: string,
  caseId: string,
): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/api/eval/datasets/${encodeURIComponent(datasetId)}/cases/${encodeURIComponent(caseId)}`,
    { method: 'DELETE' },
  );
}

export async function createDatasetVersion(
  datasetId: string,
): Promise<EvalDataset> {
  return request<EvalDataset>(
    `/api/eval/datasets/${encodeURIComponent(datasetId)}/versions`,
    { method: 'POST' },
  );
}

// ─── Evaluator Catalog (#55 Phase 4) ───────────────────────

export async function listEvaluators(params?: {
  scorerType?: string;
  tag?: string;
  status?: string;
  builtin?: boolean;
  verified?: boolean;
}): Promise<{ evaluators: EvaluatorDefinition[] }> {
  const qs = toQueryString({
    scorerType: params?.scorerType,
    tag: params?.tag,
    status: params?.status,
    builtin: params?.builtin,
    verified: params?.verified,
  });
  return request<{ evaluators: EvaluatorDefinition[] }>(`/api/eval/evaluators${qs}`);
}

export async function getEvaluator(id: string): Promise<EvaluatorDefinition> {
  return request<EvaluatorDefinition>(`/api/eval/evaluators/${encodeURIComponent(id)}`);
}

export async function createEvaluator(data: {
  name: string;
  description?: string;
  scorerType: ScorerType;
  configTemplate: Record<string, unknown>;
  tags?: string[];
}): Promise<EvaluatorDefinition> {
  return request<EvaluatorDefinition>('/api/eval/evaluators', { method: 'POST', body: JSON.stringify(data) });
}

export async function publishEvaluator(id: string): Promise<EvaluatorDefinition> {
  return request<EvaluatorDefinition>(`/api/eval/evaluators/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export async function verifyEvaluator(id: string): Promise<EvaluatorDefinition> {
  return request<EvaluatorDefinition>(`/api/eval/evaluators/${encodeURIComponent(id)}/verify`, { method: 'POST' });
}

/** DELETE returns 204 (no body) — handle directly so we don't res.json() an empty body. */
export async function deleteEvaluator(id: string): Promise<void> {
  const res = await fetch(`/api/eval/evaluators/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new ApiError(res.status, (await res.text().catch(() => '')) || `HTTP ${res.status}`);
}
