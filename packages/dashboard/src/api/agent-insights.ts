import { request } from './core';

export interface AgentInsightsData {
  agent: {
    name: string;
    description?: string;
    sessionCount: number;
    lastSeenAt: string;
    firstSeenAt: string;
  };
  totalSessions: number;
  avgScore: number | null;
  toolUsage: Record<string, number>;
  delegationCount: number;
  recentSessions: Array<{
    id: string;
    startedAt: string;
    endedAt?: string;
    eventCount: number;
  }>;
  healthTrend: Array<{
    sessionId: string;
    startedAt: string;
    score?: number;
  }>;
}

export async function getAgentInsights(agentId: string): Promise<AgentInsightsData> {
  return request<AgentInsightsData>(`/api/agents/${encodeURIComponent(agentId)}/insights`);
}
