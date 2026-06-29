/**
 * LLM connections — bring-your-own provider keys (#143).
 * Secrets are write-only: `apiKey` is sent on create but never returned (only `keyLast4`).
 */
import { request } from './core';

export interface LlmConnection {
  id: string;
  tenantId: string;
  provider: string;
  name: string;
  baseUrl?: string;
  defaultModel?: string;
  keyLast4: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionBody {
  provider: string;
  name: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}

export function listConnections(): Promise<{ connections: LlmConnection[] }> {
  return request('/api/llm-connections');
}

export function createConnection(body: CreateConnectionBody): Promise<{ connection: LlmConnection }> {
  return request('/api/llm-connections', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteConnection(id: string): Promise<{ ok: boolean }> {
  return request(`/api/llm-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function testConnection(id: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  return request(`/api/llm-connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
}
