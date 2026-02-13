import { request, toQueryString } from './core';

export interface MeshDelegation {
  id: string;
  source_agent: string;
  target_agent: string;
  task: string;
  status: string;
  result?: string;
  error?: string;
  latency_ms?: number;
  created_at: string;
}

export async function getMeshDelegations(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ delegations: MeshDelegation[]; total: number }> {
  const qs = toQueryString({ limit: params?.limit, offset: params?.offset });
  return request<{ delegations: MeshDelegation[]; total: number }>(`/api/mesh/delegations${qs}`);
}
