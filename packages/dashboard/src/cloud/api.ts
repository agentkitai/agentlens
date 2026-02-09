/**
 * Cloud API client functions (S-7.1, S-7.2)
 *
 * Org management and team management endpoints.
 */

const BASE = '';

class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ──────────────────────────────────────────────────────

export interface CloudOrg {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
}

export interface CloudOrgMember {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: string;
}

export interface CloudInvitation {
  id: string;
  org_id: string;
  email: string;
  role: string;
  invited_by: string;
  invited_by_name: string | null;
  expires_at: string;
  created_at: string;
}

// ─── Org Endpoints (S-7.1) ──────────────────────────────────────

export async function getMyOrgs(): Promise<CloudOrg[]> {
  return request<CloudOrg[]>('/api/cloud/orgs');
}

export async function createOrg(name: string): Promise<CloudOrg> {
  return request<CloudOrg>('/api/cloud/orgs', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function switchOrg(orgId: string): Promise<{ token: string }> {
  return request<{ token: string }>('/api/cloud/orgs/switch', {
    method: 'POST',
    body: JSON.stringify({ orgId }),
  });
}

// ─── Team Endpoints (S-7.2) ─────────────────────────────────────

export async function getOrgMembers(orgId: string): Promise<CloudOrgMember[]> {
  return request<CloudOrgMember[]>(`/api/cloud/orgs/${orgId}/members`);
}

export async function getOrgInvitations(orgId: string): Promise<CloudInvitation[]> {
  return request<CloudInvitation[]>(`/api/cloud/orgs/${orgId}/invitations`);
}

export async function inviteMember(
  orgId: string,
  email: string,
  role: string,
): Promise<CloudInvitation> {
  return request<CloudInvitation>(`/api/cloud/orgs/${orgId}/invitations`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function cancelInvitation(orgId: string, invitationId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/cloud/orgs/${orgId}/invitations/${invitationId}`, {
    method: 'DELETE',
  });
}

export async function changeMemberRole(
  orgId: string,
  userId: string,
  role: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/cloud/orgs/${orgId}/members/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function removeMember(orgId: string, userId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/cloud/orgs/${orgId}/members/${userId}`, {
    method: 'DELETE',
  });
}

export async function transferOwnership(orgId: string, toUserId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/cloud/orgs/${orgId}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ toUserId }),
  });
}

// ─── API Key Types (S-7.3) ──────────────────────────────────────

export type ApiKeyEnvironment = 'production' | 'staging' | 'development' | 'test';

export interface CloudApiKey {
  id: string;
  org_id: string;
  key_prefix: string;
  name: string;
  environment: ApiKeyEnvironment;
  scopes: string[];
  rate_limit_override: number | null;
  created_by: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface CreateApiKeyResponse {
  fullKey: string;
  record: CloudApiKey;
}

export interface ApiKeyLimitInfo {
  current: number;
  limit: number;
  plan: string;
}

// ─── API Key Endpoints (S-7.3) ──────────────────────────────────

export async function listApiKeys(orgId: string): Promise<CloudApiKey[]> {
  return request<CloudApiKey[]>(`/api/cloud/orgs/${orgId}/api-keys`);
}

export async function createApiKey(
  orgId: string,
  name: string,
  environment: ApiKeyEnvironment,
): Promise<CreateApiKeyResponse> {
  return request<CreateApiKeyResponse>(`/api/cloud/orgs/${orgId}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({ name, environment }),
  });
}

export async function revokeApiKey(orgId: string, keyId: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/cloud/orgs/${orgId}/api-keys/${keyId}`, {
    method: 'DELETE',
  });
}

export async function getApiKeyLimit(orgId: string): Promise<ApiKeyLimitInfo> {
  return request<ApiKeyLimitInfo>(`/api/cloud/orgs/${orgId}/api-keys/limit`);
}

// ─── Usage Types (S-7.4) ────────────────────────────────────────

export type UsageTimeRange = '7d' | '30d' | '90d';

export interface UsageSummary {
  events_count: number;
  api_calls: number;
  storage_bytes: number;
  quota_events: number;
  quota_storage_bytes: number;
  plan: string;
  period_start: string;
  period_end: string;
}

export interface UsageTimePoint {
  timestamp: string;
  events: number;
  api_calls: number;
}

export interface UsageBreakdown {
  summary: UsageSummary;
  timeseries: UsageTimePoint[];
}

// ─── Usage Endpoints (S-7.4) ────────────────────────────────────

export async function getUsage(orgId: string, range: UsageTimeRange = '30d'): Promise<UsageBreakdown> {
  return request<UsageBreakdown>(`/api/cloud/orgs/${orgId}/usage?range=${range}`);
}

export { ApiError };
