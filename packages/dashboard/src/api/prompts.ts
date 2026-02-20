import { request, toQueryString } from './core';
import type {
  PromptTemplate,
  PromptVersion,
  PromptVersionAnalytics,
} from '@agentlensai/core';

// Re-export core types for convenience
export type { PromptTemplate, PromptVersion, PromptVersionAnalytics };

// ─── Response types ─────────────────────────────────────────────

export interface PromptListResponse {
  templates: PromptTemplate[];
  total: number;
}

export interface PromptFingerprint {
  contentHash: string;
  tenantId: string;
  agentId: string;
  firstSeenAt: string;
  lastSeenAt: string;
  callCount: number;
  templateId?: string;
  sampleContent?: string;
}

export interface PromptDiffResponse {
  v1: { id: string; versionNumber: number; content: string };
  v2: { id: string; versionNumber: number; content: string };
  diff: string;
}

// ─── API Functions ──────────────────────────────────────────────

export async function getPrompts(params?: {
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<PromptListResponse> {
  const qs = toQueryString({
    category: params?.category,
    search: params?.search,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request<PromptListResponse>(`/api/prompts${qs}`);
}

export async function getPrompt(id: string): Promise<{
  template: PromptTemplate;
  versions: PromptVersion[];
}> {
  return request(`/api/prompts/${encodeURIComponent(id)}`);
}

export async function createPrompt(data: {
  name: string;
  content: string;
  description?: string;
  category?: string;
  variables?: { name: string; description?: string; defaultValue?: string; required?: boolean }[];
}): Promise<PromptTemplate> {
  return request<PromptTemplate>('/api/prompts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createPromptVersion(
  templateId: string,
  data: { content: string; changelog?: string; createdBy?: string },
): Promise<PromptVersion> {
  return request<PromptVersion>(
    `/api/prompts/${encodeURIComponent(templateId)}/versions`,
    { method: 'POST', body: JSON.stringify(data) },
  );
}

export async function getPromptVersion(
  templateId: string,
  versionId: string,
): Promise<PromptVersion> {
  return request<PromptVersion>(
    `/api/prompts/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`,
  );
}

export async function getPromptAnalytics(
  templateId: string,
  params?: { from?: string; to?: string },
): Promise<PromptVersionAnalytics[]> {
  const qs = toQueryString({ from: params?.from, to: params?.to });
  return request<PromptVersionAnalytics[]>(
    `/api/prompts/${encodeURIComponent(templateId)}/analytics${qs}`,
  );
}

export async function getPromptDiff(
  templateId: string,
  v1: string,
  v2: string,
): Promise<PromptDiffResponse> {
  const qs = toQueryString({ v1, v2 });
  return request<PromptDiffResponse>(
    `/api/prompts/${encodeURIComponent(templateId)}/diff${qs}`,
  );
}

export async function deletePrompt(id: string): Promise<void> {
  await request(`/api/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getPromptFingerprints(params?: {
  agentId?: string;
}): Promise<PromptFingerprint[]> {
  const qs = toQueryString({ agentId: params?.agentId });
  return request<PromptFingerprint[]>(`/api/prompts/fingerprints${qs}`);
}

export async function linkFingerprintToTemplate(
  hash: string,
  templateId: string,
): Promise<void> {
  await request(`/api/prompts/fingerprints/${encodeURIComponent(hash)}/link`, {
    method: 'POST',
    body: JSON.stringify({ templateId }),
  });
}
