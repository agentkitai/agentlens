/**
 * Lore Read Adapter — read-only HTTP client for Lore v0.5.0 server API.
 *
 * Maps Lore's problem/resolution server model → content-based LoreMemory type.
 * Write operations are handled by Lore's own MCP server/CLI/SDK.
 */

// ─── Types ──────────────────────────────────────────────────

/** Memory as displayed in AgentLens dashboard */
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

/** Aggregate stats from Lore */
export interface LoreStats {
  total: number;
  byType: Record<string, number>;
}

/** Paginated list response */
export interface LoreListResponse {
  memories: LoreMemory[];
  total: number;
  limit: number;
  offset: number;
}

export class LoreError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'LoreError';
  }
}

// ─── Field Mapping ──────────────────────────────────────────

/**
 * Map a Lore server lesson response → AgentLens LoreMemory.
 *
 * Follows the same convention as Lore's HttpStore._lesson_to_memory():
 * - `problem` field becomes `content` (the display text)
 * - `meta.type` becomes `type` (memory type discriminator)
 * - If `resolution` differs from `problem`, store in `metadata._resolution`
 */
export function fromLoreLesson(data: Record<string, any>): LoreMemory {
  const meta: Record<string, any> = { ...(data.meta ?? {}) };
  const type = meta.type ?? 'general';
  delete meta.type;

  const problem = data.problem ?? '';
  const resolution = data.resolution ?? '';
  if (resolution && resolution !== problem) {
    meta._resolution = resolution;
  }

  return {
    id: data.id,
    content: problem,
    type,
    context: data.context ?? null,
    tags: data.tags ?? [],
    confidence: data.confidence ?? 1.0,
    source: data.source ?? null,
    project: data.project ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    expiresAt: data.expires_at ?? null,
    upvotes: data.upvotes ?? 0,
    downvotes: data.downvotes ?? 0,
    metadata: Object.keys(meta).length > 0 ? meta : null,
  };
}

// ─── Adapter ────────────────────────────────────────────────

export class LoreReadAdapter {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: { apiUrl: string; apiKey: string; timeout?: number }) {
    this.baseUrl = config.apiUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? 10_000;
  }

  /** Health check — call on startup, non-blocking */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
        headers: this.headers,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** List memories with optional filters */
  async listMemories(query: {
    project?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<LoreListResponse> {
    const params = new URLSearchParams();
    if (query.project) params.set('project', query.project);
    if (query.search) params.set('query', query.search);
    if (query.limit != null) params.set('limit', String(query.limit));
    if (query.offset != null) params.set('offset', String(query.offset));

    const qs = params.toString();
    const data = await this.request('GET', `/v1/lessons${qs ? `?${qs}` : ''}`);
    return {
      memories: (data.lessons ?? []).map(fromLoreLesson),
      total: data.total,
      limit: data.limit,
      offset: data.offset,
    };
  }

  /** Get single memory by ID */
  async getMemory(id: string): Promise<LoreMemory | null> {
    try {
      const data = await this.request('GET', `/v1/lessons/${id}`);
      return fromLoreLesson(data);
    } catch (err) {
      if (err instanceof LoreError && err.statusCode === 404) return null;
      throw err;
    }
  }

  /** Get aggregate stats (count by type) */
  async getStats(project?: string): Promise<LoreStats> {
    const params = new URLSearchParams({ limit: '200' });
    if (project) params.set('project', project);
    const data = await this.request('GET', `/v1/lessons?${params}`);
    const byType: Record<string, number> = {};
    for (const lesson of data.lessons ?? []) {
      const t = lesson.meta?.type ?? 'general';
      byType[t] = (byType[t] ?? 0) + 1;
    }
    return { total: data.total, byType };
  }

  // --- Private ---

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  private async request(method: string, path: string): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new LoreError(res.status, `Lore API error (${res.status}): ${text}`);
    }
    return res.json();
  }
}

// ─── Factory ────────────────────────────────────────────────

/** Create adapter if Lore is configured, else return null */
export function createLoreAdapter(env: {
  loreEnabled?: boolean;
  loreApiUrl?: string;
  loreApiKey?: string;
}): LoreReadAdapter | null {
  if (!env.loreEnabled) return null;
  if (!env.loreApiUrl) throw new Error('LORE_API_URL required when LORE_ENABLED=true');
  if (!env.loreApiKey) throw new Error('LORE_API_KEY required when LORE_ENABLED=true');
  return new LoreReadAdapter({
    apiUrl: env.loreApiUrl,
    apiKey: env.loreApiKey,
  });
}
