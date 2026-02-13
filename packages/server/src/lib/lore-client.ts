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
  searchCommunity(query: string, options?: { category?: string; limit?: number; minReputation?: number }): Promise<{ lessons: any[]; total: number }>;
  rateLesson(id: string, delta: number): Promise<any>;

  // Sharing endpoints
  getSharingConfig(): Promise<any>;
  updateSharingConfig(data: any): Promise<any>;
  getAgentSharingConfigs(): Promise<any>;
  updateAgentSharingConfig(agentId: string, data: any): Promise<any>;
  getDenyList(): Promise<any>;
  addDenyListRule(data: any): Promise<any>;
  deleteDenyListRule(id: string): Promise<any>;
  getSharingAuditLog(params: { eventType?: string; from?: string; to?: string; limit?: number }): Promise<any>;
  getSharingStats(): Promise<any>;
  purgeSharing(confirmation: string): Promise<any>;
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
  const { problem, resolution, tags, reputation_score, quality_signals, ...rest } = data;
  return {
    ...(problem !== undefined ? { title: problem } : {}),
    ...(resolution !== undefined ? { content: resolution } : {}),
    ...(tags?.length ? { category: tags[0] } : {}),
    ...(reputation_score !== undefined ? { reputationScore: reputation_score } : {}),
    ...(quality_signals !== undefined ? { qualitySignals: quality_signals } : {}),
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

  async searchCommunity(query: string, options?: { category?: string; limit?: number; minReputation?: number }) {
    const params = new URLSearchParams({ q: query });
    if (options?.category) params.set('category', options.category);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.minReputation !== undefined) params.set('minReputation', String(options.minReputation));
    const result = await this.request('GET', `/v1/lessons/search?${params}`);
    return { ...result, lessons: (result.lessons ?? []).map(fromLoreFormat) };
  }

  async rateLesson(id: string, delta: number) {
    return this.request('POST', `/v1/lessons/${id}/rate`, { delta });
  }

  async getSharingConfig() {
    return this.request('GET', '/v1/sharing/config');
  }

  async updateSharingConfig(data: any) {
    return this.request('PUT', '/v1/sharing/config', data);
  }

  async getAgentSharingConfigs() {
    return this.request('GET', '/v1/sharing/agents');
  }

  async updateAgentSharingConfig(agentId: string, data: any) {
    return this.request('PUT', `/v1/sharing/agents/${agentId}`, data);
  }

  async getDenyList() {
    return this.request('GET', '/v1/sharing/deny-list');
  }

  async addDenyListRule(data: any) {
    return this.request('POST', '/v1/sharing/deny-list', data);
  }

  async deleteDenyListRule(id: string) {
    return this.request('DELETE', `/v1/sharing/deny-list/${id}`);
  }

  async getSharingAuditLog(params: { eventType?: string; from?: string; to?: string; limit?: number }) {
    const qs = new URLSearchParams();
    if (params.eventType) qs.set('event_type', params.eventType);
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.limit) qs.set('limit', String(params.limit));
    return this.request('GET', `/v1/sharing/audit?${qs}`);
  }

  async getSharingStats() {
    return this.request('GET', '/v1/sharing/stats');
  }

  async purgeSharing(confirmation: string) {
    return this.request('POST', '/v1/sharing/purge', { confirmation });
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
  async rateLesson(_id: string, _delta: number): Promise<any> { throw new Error('Not available in local mode'); }
  async getSharingConfig(): Promise<any> { throw new Error('Not available in local mode'); }
  async updateSharingConfig(_data: any): Promise<any> { throw new Error('Not available in local mode'); }
  async getAgentSharingConfigs(): Promise<any> { throw new Error('Not available in local mode'); }
  async updateAgentSharingConfig(_agentId: string, _data: any): Promise<any> { throw new Error('Not available in local mode'); }
  async getDenyList(): Promise<any> { throw new Error('Not available in local mode'); }
  async addDenyListRule(_data: any): Promise<any> { throw new Error('Not available in local mode'); }
  async deleteDenyListRule(_id: string): Promise<any> { throw new Error('Not available in local mode'); }
  async getSharingAuditLog(_params: any): Promise<any> { throw new Error('Not available in local mode'); }
  async getSharingStats(): Promise<any> { throw new Error('Not available in local mode'); }
  async purgeSharing(_confirmation: string): Promise<any> { throw new Error('Not available in local mode'); }
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
