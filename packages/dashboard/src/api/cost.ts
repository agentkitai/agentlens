import { request, toQueryString } from './core';

export interface OptimizationRecommendation {
  agentId?: string;
  agentName?: string;
  currentModel: string;
  recommendedModel: string;
  complexityTier: string;
  monthlySavings: number;
  confidence: 'low' | 'medium' | 'high';
  callVolume: number;
}

export interface OptimizationRecommendationsData {
  recommendations: OptimizationRecommendation[];
  period: number;
  totalPotentialSavings: number;
}

export async function getOptimizationRecommendations(params: {
  period?: number;
  limit?: number;
  agentId?: string;
}): Promise<OptimizationRecommendationsData> {
  const qs = toQueryString({
    period: params.period,
    limit: params.limit,
    agentId: params.agentId,
  });
  return request<OptimizationRecommendationsData>(`/api/optimize/recommendations${qs}`);
}
