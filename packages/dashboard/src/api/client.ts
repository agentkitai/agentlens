/**
 * Typed API client for AgentLens Dashboard
 *
 * All functions hit the server via relative URLs (proxied by Vite in dev).
 */

import type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  Session,
  SessionQuery,
  SessionQueryResult,
  Agent,
  StorageStats,
} from '@agentlens/core';

// ─── Helpers ────────────────────────────────────────────────────────

const BASE = '';

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

function toQueryString(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      sp.set(key, val.join(','));
    } else {
      sp.set(key, String(val));
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

// ─── Events ─────────────────────────────────────────────────────────

export async function getEvents(query: EventQuery = {}): Promise<EventQueryResult> {
  const qs = toQueryString({
    sessionId: query.sessionId,
    agentId: query.agentId,
    eventType: Array.isArray(query.eventType) ? query.eventType : query.eventType ? [query.eventType] : undefined,
    severity: Array.isArray(query.severity) ? query.severity : query.severity ? [query.severity] : undefined,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
    order: query.order,
    search: query.search,
  });
  return request<EventQueryResult>(`/api/events${qs}`);
}

// ─── Sessions ───────────────────────────────────────────────────────

export async function getSessions(query: SessionQuery = {}): Promise<SessionQueryResult & { hasMore: boolean }> {
  const qs = toQueryString({
    agentId: query.agentId,
    status: query.status,
    from: query.from,
    to: query.to,
    limit: query.limit,
    offset: query.offset,
    tags: query.tags,
  });
  return request<SessionQueryResult & { hasMore: boolean }>(`/api/sessions${qs}`);
}

export async function getSession(id: string): Promise<Session> {
  return request<Session>(`/api/sessions/${encodeURIComponent(id)}`);
}

export interface SessionTimeline {
  events: AgentLensEvent[];
  chainValid: boolean;
}

export async function getSessionTimeline(id: string): Promise<SessionTimeline> {
  return request<SessionTimeline>(`/api/sessions/${encodeURIComponent(id)}/timeline`);
}

// ─── Agents ─────────────────────────────────────────────────────────

interface AgentsResponse {
  agents: Agent[];
}

export async function getAgents(): Promise<Agent[]> {
  const data = await request<AgentsResponse>('/api/agents');
  return data.agents;
}

export async function getAgent(id: string): Promise<Agent> {
  return request<Agent>(`/api/agents/${encodeURIComponent(id)}`);
}

// ─── Stats ──────────────────────────────────────────────────────────

export async function getStats(): Promise<StorageStats> {
  return request<StorageStats>('/api/stats');
}

// ─── API Keys ───────────────────────────────────────────────────────

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

// ─── Config ─────────────────────────────────────────────────────────

export interface ConfigData {
  retentionDays: number;
  agentGateUrl: string;
  agentGateSecret: string;
  formBridgeUrl: string;
  formBridgeSecret: string;
}

export async function getConfig(): Promise<ConfigData> {
  return request<ConfigData>('/api/config');
}

export async function updateConfig(data: Partial<ConfigData>): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export { ApiError };
