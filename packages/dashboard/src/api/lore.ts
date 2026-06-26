import { request, toQueryString, ApiError } from './core';

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

/** A supersession edge in a memory's lineage (#82). */
export interface SupersessionLink {
  memoryId: string;
  supersededBy: string | null;
  reason: string | null;
  ts: string;
  agent: string;
}

/** Aggregated provenance/lineage for one memory (#82). */
export interface LoreProvenance {
  id: string;
  owner: string | null;
  visibility: string;
  source: string | null;
  tags: string[];
  redactionTags: string[];
  trustSignal: string; // "owned" | "anonymous"
  supersessionChain: SupersessionLink[];
  supersessionSources: SupersessionLink[];
  createdAt: string;
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

export async function getMemoryProvenance(id: string): Promise<LoreProvenance | null> {
  try {
    return await request<LoreProvenance>(`/api/lore/memories/${encodeURIComponent(id)}/provenance`);
  } catch (err) {
    // Mirror the server adapter: a missing memory (or a Lore that predates the
    // provenance endpoint) is a 404 → null, not a scary error.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
