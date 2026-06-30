/**
 * Core API helpers — request(), ApiError, toQueryString
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
} from '@agentkitai/agentlens-core';

// Re-export core types so domain modules can use them
export type { AgentLensEvent, EventQuery, EventQueryResult, Session, SessionQuery, SessionQueryResult, Agent, StorageStats };

import { getActiveProjectId } from './active-project';

const BASE = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Scope the request to the active project (#231). Server resolves + membership-
  // checks it (resolveProjectScope). init.headers may still override.
  const projectId = getActiveProjectId();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(projectId ? { 'X-Project-Id': projectId } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function toQueryString(params: Record<string, string | number | boolean | string[] | undefined>): string {
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
