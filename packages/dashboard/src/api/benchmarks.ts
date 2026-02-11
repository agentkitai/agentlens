import { request, toQueryString } from './core';

export type BenchmarkStatus = 'draft' | 'running' | 'completed' | 'cancelled';

export interface BenchmarkVariant {
  id?: string;
  name: string;
  tag: string;
  description?: string;
  sessionCount?: number;
}

export interface BenchmarkData {
  id: string;
  name: string;
  description?: string;
  status: BenchmarkStatus;
  agentId?: string;
  agentName?: string;
  variants: BenchmarkVariant[];
  metrics: string[];
  minSessions: number;
  startDate?: string;
  endDate?: string;
  totalSessions: number;
  createdAt: string;
  updatedAt: string;
}

export interface BenchmarkListResponse {
  benchmarks: BenchmarkData[];
  total: number;
  hasMore: boolean;
}

export interface CreateBenchmarkData {
  name: string;
  description?: string;
  agentId?: string;
  minSessions?: number;
  variants: { name: string; tag: string; description?: string }[];
  metrics: string[];
  startDate?: string;
  endDate?: string;
}

export interface BenchmarkVariantResult {
  variantId: string;
  variantName: string;
  mean: number;
  median: number;
  stdDev: number;
  sampleSize: number;
  ci95: [number, number];
  values?: number[];
}

export interface BenchmarkMetricResult {
  metric: string;
  variantResults: BenchmarkVariantResult[];
  pValue?: number;
  significant?: boolean;
  diffPercent?: number;
  confidenceLevel?: number;
  winnerId?: string;
}

export interface BenchmarkResultsData {
  benchmarkId: string;
  metrics: BenchmarkMetricResult[];
  summary?: {
    winner?: string;
    winnerName?: string;
    confidence: number;
    recommendation: string;
    details?: string[];
  };
}

export async function getBenchmarks(params?: {
  status?: BenchmarkStatus;
  limit?: number;
  offset?: number;
}): Promise<BenchmarkListResponse> {
  const qs = toQueryString({
    status: params?.status,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request<BenchmarkListResponse>(`/api/benchmarks${qs}`);
}

export async function createBenchmark(data: CreateBenchmarkData): Promise<BenchmarkData> {
  return request<BenchmarkData>('/api/benchmarks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getBenchmark(id: string): Promise<BenchmarkData> {
  return request<BenchmarkData>(`/api/benchmarks/${encodeURIComponent(id)}`);
}

export async function updateBenchmarkStatus(
  id: string,
  status: BenchmarkStatus,
): Promise<BenchmarkData> {
  return request<BenchmarkData>(`/api/benchmarks/${encodeURIComponent(id)}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export async function getBenchmarkResults(
  id: string,
  params?: { includeDistributions?: boolean },
): Promise<BenchmarkResultsData> {
  const qs = toQueryString({
    includeDistributions: params?.includeDistributions,
  });
  return request<BenchmarkResultsData>(`/api/benchmarks/${encodeURIComponent(id)}/results${qs}`);
}

export async function deleteBenchmark(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/benchmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
