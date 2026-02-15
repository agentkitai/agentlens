import { request, toQueryString } from './core';

// Mesh agent record (from agentkit-mesh HTTP API)
export interface MeshAgent {
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  protocol: string;
  registered_at: string;
  last_seen: string;
}

export interface DiscoveryResult {
  agent: MeshAgent;
  score: number;
  matchedTerms: string[];
}

export async function getMeshAgents(): Promise<MeshAgent[]> {
  return request<MeshAgent[]>('/api/mesh/agents');
}

export async function registerMeshAgent(data: {
  name: string;
  description: string;
  capabilities: string[];
  endpoint: string;
}): Promise<MeshAgent> {
  return request<MeshAgent>('/api/mesh/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function unregisterMeshAgent(name: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/mesh/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export async function discoverAgents(params?: {
  query?: string;
  taskType?: string;
  minTrustScore?: number;
  maxCostUsd?: number;
  maxLatencyMs?: number;
  limit?: number;
}): Promise<{ results: any[] }> {
  const qs = toQueryString({
    query: params?.query,
    taskType: params?.taskType,
    minTrustScore: params?.minTrustScore,
    maxCostUsd: params?.maxCostUsd,
    maxLatencyMs: params?.maxLatencyMs,
    limit: params?.limit,
  });
  return request<{ results: any[] }>(`/api/mesh/discover${qs}`);
}

// --- Capability registry (Stories 7.3) ---

export interface CapabilityData {
  id: string;
  taskType: string;
  enabled: boolean;
  [key: string]: unknown;
}

export async function getCapabilities(params?: {
  taskType?: string;
  agentId?: string;
}): Promise<{ capabilities: CapabilityData[] }> {
  const qs = toQueryString({ taskType: params?.taskType, agentId: params?.agentId });
  return request<{ capabilities: CapabilityData[] }>(`/api/capabilities${qs}`);
}

export async function registerCapability(data: Record<string, unknown>): Promise<CapabilityData> {
  return request<CapabilityData>('/api/capabilities', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateCapability(id: string, data: Record<string, unknown>): Promise<CapabilityData> {
  return request<CapabilityData>(`/api/capabilities/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
