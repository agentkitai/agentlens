import { request } from './core';

export interface ApiKeyInfo {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface KeysResponse {
  keys: ApiKeyInfo[];
}

export interface ApiKeyCreated extends ApiKeyInfo {
  key: string;
}

export async function getKeys(): Promise<ApiKeyInfo[]> {
  const data = await request<KeysResponse>('/api/keys');
  return data.keys;
}

export async function createKey(name?: string, scopes?: string[]): Promise<ApiKeyCreated> {
  return request<ApiKeyCreated>('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ name, scopes }),
  });
}

export async function revokeKey(id: string): Promise<{ id: string; revoked: boolean }> {
  return request<{ id: string; revoked: boolean }>(`/api/keys/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** GET /api/config response — secrets are write-only, so only their "is set" flag
 *  is returned, never the value. */
export interface ConfigData {
  retentionDays: number;
  agentGateUrl: string;
  agentGateSecretSet: boolean;
  formBridgeUrl: string;
  formBridgeSecretSet: boolean;
}

/** PUT /api/config body — any subset; secrets are sent as plaintext to be stored. */
export interface ConfigUpdate {
  retentionDays?: number;
  agentGateUrl?: string;
  agentGateSecret?: string;
  formBridgeUrl?: string;
  formBridgeSecret?: string;
}

export async function getConfig(): Promise<ConfigData> {
  return request<ConfigData>('/api/config');
}

export async function updateConfig(data: ConfigUpdate): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}
