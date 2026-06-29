import { request, toQueryString } from './core';
import type {
  PromptTemplate,
  PromptVersion,
  PromptVersionAnalytics,
  PromptDeployment,
  PromptEnvironment,
  PromptAgentUsage,
  DeployLedgerVerifyResult,
} from '@agentkitai/agentlens-core';

// Re-export core types for convenience
export type {
  PromptTemplate,
  PromptVersion,
  PromptVersionAnalytics,
  PromptDeployment,
  PromptEnvironment,
  PromptAgentUsage,
  DeployLedgerVerifyResult,
};

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
  /** environment → live version id (#120). */
  liveVersions?: Record<string, string>;
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

// ─── Deploy lifecycle (#120) ────────────────────────────────────

export async function getPromptEnvironments(): Promise<PromptEnvironment[]> {
  const r = await request<{ environments: PromptEnvironment[] }>('/api/prompts/environments');
  return r.environments;
}

export async function getPromptDeployments(
  templateId: string,
  environment?: string,
): Promise<PromptDeployment[]> {
  const qs = toQueryString({ environment });
  const r = await request<{ deployments: PromptDeployment[] }>(
    `/api/prompts/${encodeURIComponent(templateId)}/deployments${qs}`,
  );
  return r.deployments;
}

export async function deployPromptVersion(
  templateId: string,
  data: { environment: string; versionId: string; note?: string },
): Promise<PromptDeployment> {
  const r = await request<{ deployment: PromptDeployment }>(
    `/api/prompts/${encodeURIComponent(templateId)}/deploy`,
    { method: 'POST', body: JSON.stringify(data) },
  );
  return r.deployment;
}

export async function rollbackPromptVersion(
  templateId: string,
  data: { environment: string; toVersionId: string; note?: string },
): Promise<PromptDeployment> {
  const r = await request<{ deployment: PromptDeployment }>(
    `/api/prompts/${encodeURIComponent(templateId)}/rollback`,
    { method: 'POST', body: JSON.stringify(data) },
  );
  return r.deployment;
}

export async function verifyDeployLedger(environment: string): Promise<DeployLedgerVerifyResult> {
  const qs = toQueryString({ environment });
  return request<DeployLedgerVerifyResult>(`/api/prompts/deployments/verify${qs}`);
}

export async function getPromptAgentUsage(
  templateId: string,
  params?: { from?: string; to?: string },
): Promise<PromptAgentUsage[]> {
  const qs = toQueryString({ from: params?.from, to: params?.to });
  const r = await request<{ usage: PromptAgentUsage[] }>(
    `/api/prompts/${encodeURIComponent(templateId)}/analytics/by-agent${qs}`,
  );
  return r.usage;
}
