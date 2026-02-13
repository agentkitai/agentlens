/**
 * Mesh Adapter — abstraction for agentkit-mesh HTTP API
 */

export interface MeshAdapter {
  listAgents(): Promise<any>;
  registerAgent(data: any): Promise<any>;
  getAgent(name: string): Promise<any>;
  unregisterAgent(name: string): Promise<any>;
  heartbeatAgent(name: string): Promise<any>;
  discover(query: string, limit?: number): Promise<any>;
  delegate(data: any): Promise<any>;
  listDelegations(limit?: number, offset?: number): Promise<any>;
}

export class MeshError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'MeshError';
  }
}

export class RemoteMeshAdapter implements MeshAdapter {
  constructor(private baseUrl: string) {}

  private async request(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new MeshError(res.status, `Mesh API error: ${text}`);
    }
    // 204 No Content
    if (res.status === 204) return {};
    return res.json();
  }

  async listAgents() {
    return this.request('GET', '/v1/agents');
  }

  async registerAgent(data: any) {
    return this.request('POST', '/v1/agents', data);
  }

  async getAgent(name: string) {
    return this.request('GET', `/v1/agents/${encodeURIComponent(name)}`);
  }

  async unregisterAgent(name: string) {
    return this.request('DELETE', `/v1/agents/${encodeURIComponent(name)}`);
  }

  async heartbeatAgent(name: string) {
    return this.request('POST', `/v1/agents/${encodeURIComponent(name)}/heartbeat`);
  }

  async discover(query: string, limit?: number) {
    const params = new URLSearchParams({ query });
    if (limit !== undefined) params.set('limit', String(limit));
    return this.request('GET', `/v1/discover?${params}`);
  }

  async delegate(data: any) {
    return this.request('POST', '/v1/delegate', data);
  }

  async listDelegations(limit?: number, offset?: number) {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString();
    return this.request('GET', `/v1/delegations${qs ? '?' + qs : ''}`);
  }
}
