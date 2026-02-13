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

export async function discoverAgents(query: string, limit?: number): Promise<DiscoveryResult[]> {
  const qs = toQueryString({ query, limit });
  return request<DiscoveryResult[]>(`/api/mesh/discover${qs}`);
}
