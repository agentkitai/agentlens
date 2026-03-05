import { request, toQueryString } from './core';

export interface LoreMemory {
  id: string;
  content: string;
  type: string;
  context: string | null;
  tags: string[];
  confidence: number;
  source: string | null;
  project: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  upvotes: number;
  downvotes: number;
  metadata: Record<string, unknown> | null;
}

export interface LoreListResponse {
  memories: LoreMemory[];
  total: number;
}

export interface LoreStats {
  total: number;
  byType: Record<string, number>;
}

export async function getMemories(params?: {
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<LoreListResponse> {
  const qs = toQueryString({
    search: params?.search,
    limit: params?.limit,
    offset: params?.offset,
  });
  return request<LoreListResponse>(`/api/lore/memories${qs}`);
}

export async function getMemory(id: string): Promise<LoreMemory> {
  return request<LoreMemory>(`/api/lore/memories/${encodeURIComponent(id)}`);
}

export async function getLoreStats(): Promise<LoreStats> {
  return request<LoreStats>('/api/lore/stats');
}
