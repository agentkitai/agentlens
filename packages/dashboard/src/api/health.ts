import { request, toQueryString } from './core';

export interface AgentHealth {
  agentId: string;
  agentName?: string;
  overallScore: number;
  trend: 'improving' | 'stable' | 'degrading';
  dimensions: Record<string, number>;
}

export interface HealthOverviewData {
  agents: AgentHealth[];
  window: number;
}

export async function getHealthOverview(params: {
  window?: number;
}): Promise<HealthOverviewData> {
  const qs = toQueryString({ window: params.window });
  return request<HealthOverviewData>(`/api/health/overview${qs}`);
}
