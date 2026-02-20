import { request, toQueryString } from './core';
import type { EvalDataset, EvalTestCase, EvalInput, ScorerConfig } from '@agentlensai/core';

// Re-export for convenience
export type { EvalDataset, EvalTestCase };

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
