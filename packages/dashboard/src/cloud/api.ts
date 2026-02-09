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

export { ApiError };
