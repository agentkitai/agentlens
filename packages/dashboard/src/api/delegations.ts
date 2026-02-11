import { request, toQueryString } from './core';

export interface DelegationLogData {
  id: string;
  tenantId: string;
  direction: string;
  agentId: string;
  anonymousTargetId?: string;
  anonymousSourceId?: string;
  taskType: string;
  status: string;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  executionTimeMs?: number;
  costUsd?: number;
  createdAt: string;
  completedAt?: string;
}

export async function getDelegations(params?: {
  direction?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<{ delegations: DelegationLogData[]; total: number }> {
  const qs = toQueryString({
    direction: params?.direction,
    status: params?.status,
    from: params?.from,
    to: params?.to,
    limit: params?.limit,
  });
  return request<{ delegations: DelegationLogData[]; total: number }>(`/api/delegations${qs}`);
}
