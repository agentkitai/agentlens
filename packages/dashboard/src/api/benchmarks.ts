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
  minSessionsPerVariant?: number;
  variants: { name: string; tag: string; description?: string }[];
  metrics: string[];
  timeRange?: { from?: string; to?: string };
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

// The server returns a variant-centric BenchmarkResults ({ variants[], comparisons[],
// summary: string }). The UI wants a metric-centric shape ({ metrics: [...], summary:
// object }). Pivot it here so ComparisonTable, DistributionChart and the Summary card
// all get what they expect (previously results.metrics was undefined → crash/empty).
function toResultsData(raw: any): BenchmarkResultsData {
  const variants: any[] = raw?.variants ?? [];
  const comparisons: any[] = raw?.comparisons ?? [];

  const metricKeys = new Set<string>();
  for (const v of variants) for (const k of Object.keys(v?.metrics ?? {})) metricKeys.add(k);

  const metrics: BenchmarkMetricResult[] = [...metricKeys].map((metric) => {
    const variantResults: BenchmarkVariantResult[] = variants
      .filter((v) => v?.metrics?.[metric])
      .map((v) => {
        const s = v.metrics[metric];
        const se = s.count > 0 ? s.stddev / Math.sqrt(s.count) : 0;
        return {
          variantId: v.variantId,
          variantName: v.variantName,
          mean: s.mean,
          median: s.median,
          stdDev: s.stddev,
          sampleSize: s.count,
          ci95: [s.mean - 1.96 * se, s.mean + 1.96 * se] as [number, number],
          values: s.values,
        };
      });
    const comp = comparisons.find((c) => c?.metric === metric);
    return {
      metric,
      variantResults,
      pValue: comp?.pValue,
      significant: comp?.significant,
      diffPercent: comp?.percentDiff,
    };
  });

  return {
    benchmarkId: raw?.benchmarkId,
    metrics,
    summary: typeof raw?.summary === 'string' ? { confidence: 0, recommendation: raw.summary } : raw?.summary,
  };
}

export async function getBenchmarkResults(
  id: string,
  params?: { includeDistributions?: boolean },
): Promise<BenchmarkResultsData> {
  const qs = toQueryString({
    includeDistributions: params?.includeDistributions,
  });
  const raw = await request<any>(`/api/benchmarks/${encodeURIComponent(id)}/results${qs}`);
  return toResultsData(raw);
}

export async function deleteBenchmark(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/benchmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
