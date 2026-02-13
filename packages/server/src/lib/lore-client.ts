/**
 * Lore Adapter — abstraction for lesson CRUD via Lore service
 *
 * Two implementations:
 * - RemoteLoreAdapter: HTTP proxy to a remote Lore server
 * - LocalLoreAdapter: delegates to lore-sdk (conditional import)
 */

export interface LoreAdapter {
  createLesson(data: { title: string; content: string; category?: string; importance?: string; agentId?: string; context?: Record<string, unknown> }): Promise<any>;
  listLessons(query: { category?: string; agentId?: string; importance?: string; search?: string; limit?: number; offset?: number }): Promise<{ lessons: any[]; total: number; hasMore: boolean }>;
  getLesson(id: string): Promise<any>;
  updateLesson(id: string, data: Partial<any>): Promise<any>;
  deleteLesson(id: string): Promise<{ id: string; archived: boolean }>;
  searchCommunity(query: string, options?: { category?: string; limit?: number }): Promise<{ lessons: any[]; total: number }>;
}

/** Map AgentLens lesson format → Lore format */
function toLoreFormat(data: { title?: string; content?: string; category?: string; [k: string]: any }) {
  const { title, content, category, ...rest } = data;
  return {
    ...(title !== undefined ? { problem: title } : {}),
    ...(content !== undefined ? { resolution: content } : {}),
    ...(category !== undefined ? { tags: [category] } : {}),
    ...rest,
  };
}

/** Map Lore format → AgentLens lesson format */
function fromLoreFormat(data: any): any {
  if (!data) return data;
  const { problem, resolution, tags, ...rest } = data;
  return {
    ...(problem !== undefined ? { title: problem } : {}),
    ...(resolution !== undefined ? { content: resolution } : {}),
    ...(tags?.length ? { category: tags[0] } : {}),
    ...rest,
  };
}

export class LoreError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'LoreError';
  }
}

export class RemoteLoreAdapter implements LoreAdapter {
  constructor(private baseUrl: string, private apiKey: string) {}

  private get headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new LoreError(res.status, `Lore API error: ${text}`);
    }
    return res.json();
  }

  async createLesson(data: Parameters<LoreAdapter['createLesson']>[0]) {
    const result = await this.request('POST', '/v1/lessons', toLoreFormat(data));
    return fromLoreFormat(result);
  }

  async listLessons(query: Parameters<LoreAdapter['listLessons']>[0]) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) params.set(k, String(v));
    }
    const result = await this.request('GET', `/v1/lessons?${params}`);
    return { ...result, lessons: (result.lessons ?? []).map(fromLoreFormat) };
  }

  async getLesson(id: string) {
    const result = await this.request('GET', `/v1/lessons/${id}`);
    return fromLoreFormat(result);
  }

  async updateLesson(id: string, data: Partial<any>) {
    const result = await this.request('PUT', `/v1/lessons/${id}`, toLoreFormat(data));
    return fromLoreFormat(result);
  }

  async deleteLesson(id: string) {
    return this.request('DELETE', `/v1/lessons/${id}`);
  }

  async searchCommunity(query: string, options?: { category?: string; limit?: number }) {
    const params = new URLSearchParams({ q: query });
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', String(options.limit));
    const result = await this.request('GET', `/v1/lessons/search?${params}`);
    return { ...result, lessons: (result.lessons ?? []).map(fromLoreFormat) };
  }
}

export class LocalLoreAdapter implements LoreAdapter {
  private sdk: any;

  constructor(dbPath: string) {
    try {
      // Dynamic import placeholder — lore-sdk is not yet a dependency
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.sdk = require('lore-sdk');
    } catch {
      throw new Error(
        'lore-sdk is not installed. Install it with: npm install lore-sdk\n' +
        'Or switch to remote mode by setting LORE_MODE=remote and LORE_API_URL.',
      );
    }
    this.sdk.init({ dbPath });
  }

  async createLesson(data: Parameters<LoreAdapter['createLesson']>[0]) { return this.sdk.createLesson(data); }
  async listLessons(query: Parameters<LoreAdapter['listLessons']>[0]) { return this.sdk.listLessons(query); }
  async getLesson(id: string) { return this.sdk.getLesson(id); }
  async updateLesson(id: string, data: Partial<any>) { return this.sdk.updateLesson(id, data); }
  async deleteLesson(id: string) { return this.sdk.deleteLesson(id); }
  async searchCommunity(query: string, options?: { category?: string; limit?: number }) { return this.sdk.searchCommunity(query, options); }
}

/** Factory: create the right adapter based on config */
export function createLoreAdapter(config: {
  loreMode: string;
  loreApiUrl?: string;
  loreApiKey?: string;
  loreDbPath?: string;
}): LoreAdapter {
  if (config.loreMode === 'remote') {
    if (!config.loreApiUrl) throw new Error('LORE_API_URL is required for remote mode');
    return new RemoteLoreAdapter(config.loreApiUrl, config.loreApiKey ?? '');
  }
  return new LocalLoreAdapter(config.loreDbPath ?? './lore.db');
}
