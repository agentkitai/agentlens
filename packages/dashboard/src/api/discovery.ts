import { request, toQueryString } from './core';

export interface CapabilityData {
  id: string;
  tenantId: string;
  agentId: string;
  taskType: string;
  customType?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  scope: string;
  enabled: boolean;
  acceptDelegations: boolean;
  estimatedCostUsd?: number;
  estimatedLatencyMs?: number;
  qualityMetrics: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryResultData {
  anonymousAgentId: string;
  taskType: string;
  trustScorePercentile: number;
  provisional: boolean;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  qualityMetrics: Record<string, unknown>;
}

export async function getCapabilities(params?: {
  taskType?: string;
  agentId?: string;
}): Promise<{ capabilities: CapabilityData[] }> {
  const qs = toQueryString({ taskType: params?.taskType, agentId: params?.agentId });
  return request<{ capabilities: CapabilityData[] }>(`/api/capabilities${qs}`);
}

export async function registerCapability(data: Partial<CapabilityData>): Promise<CapabilityData> {
  return request<CapabilityData>('/api/capabilities', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCapability(id: string, data: Partial<CapabilityData>): Promise<CapabilityData> {
  return request<CapabilityData>(`/api/capabilities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function discoverAgents(params: {
  taskType: string;
  minTrustScore?: number;
  maxCostUsd?: number;
  maxLatencyMs?: number;
  limit?: number;
}): Promise<{ results: DiscoveryResultData[] }> {
  const qs = toQueryString(params);
  return request<{ results: DiscoveryResultData[] }>(`/api/discovery${qs}`);
}
