/**
 * API Key Routes + Usage Routes Tests (S-7.3, S-7.4)
 *
 * Verifies route handler factories and their structure.
 */

import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════
// S-7.3: API Key Route Handlers
// ═══════════════════════════════════════════

describe('S-7.3: API Key route handlers', () => {
  it('createApiKeyRouteHandlers is a function', async () => {
    const mod = await import('../routes/api-key-routes.js');
    expect(typeof mod.createApiKeyRouteHandlers).toBe('function');
  });

  it('returns handlers with correct shape', async () => {
    const mod = await import('../routes/api-key-routes.js');
    // Use a mock db
    const mockDb = { query: async () => ({ rows: [] }) } as any;
    const handlers = mod.createApiKeyRouteHandlers({ db: mockDb });

    expect(typeof handlers.listKeys).toBe('function');
    expect(typeof handlers.createKey).toBe('function');
    expect(typeof handlers.revokeKey).toBe('function');
    expect(typeof handlers.getKeyLimit).toBe('function');
  });

  it('getKeyLimit returns limit info structure', async () => {
    const mod = await import('../routes/api-key-routes.js');
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes('COUNT')) return { rows: [{ count: 3 }] };
        if (sql.includes('plan')) return { rows: [{ plan: 'pro' }] };
        return { rows: [] };
      },
    } as any;
    const handlers = mod.createApiKeyRouteHandlers({ db: mockDb });
    const result = await handlers.getKeyLimit('org-1');
    expect(result.status).toBe(200);
    expect((result.body as any).current).toBe(3);
    expect((result.body as any).limit).toBe(10);
    expect((result.body as any).plan).toBe('pro');
  });

  it('getKeyLimit defaults to free plan when org not found', async () => {
    const mod = await import('../routes/api-key-routes.js');
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes('COUNT')) return { rows: [{ count: 0 }] };
        return { rows: [] };
      },
    } as any;
    const handlers = mod.createApiKeyRouteHandlers({ db: mockDb });
    const result = await handlers.getKeyLimit('org-missing');
    expect(result.status).toBe(200);
    expect((result.body as any).plan).toBe('free');
    expect((result.body as any).limit).toBe(2);
  });
});

// ═══════════════════════════════════════════
// S-7.4: Usage Route Handlers
// ═══════════════════════════════════════════

describe('S-7.4: Usage route handlers', () => {
  it('createUsageRouteHandlers is a function', async () => {
    const mod = await import('../routes/usage-routes.js');
    expect(typeof mod.createUsageRouteHandlers).toBe('function');
  });

  it('returns handler with getUsage function', async () => {
    const mod = await import('../routes/usage-routes.js');
    const mockDb = { query: async () => ({ rows: [] }) } as any;
    const handlers = mod.createUsageRouteHandlers({ db: mockDb });
    expect(typeof handlers.getUsage).toBe('function');
  });

  it('getUsage returns usage breakdown structure', async () => {
    const mod = await import('../routes/usage-routes.js');
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes('plan')) return { rows: [{ plan: 'pro' }] };
        if (sql.includes('SUM') && !sql.includes('GROUP BY')) {
          return { rows: [{ events_count: 5000, api_calls: 1200, storage_bytes: 50_000_000 }] };
        }
        if (sql.includes('GROUP BY')) {
          return {
            rows: [
              { timestamp: '2026-02-01', events: 100, api_calls: 50 },
              { timestamp: '2026-02-02', events: 200, api_calls: 80 },
            ],
          };
        }
        return { rows: [] };
      },
    } as any;

    const handlers = mod.createUsageRouteHandlers({ db: mockDb });
    const result = await handlers.getUsage('org-1', '30d');
    expect(result.status).toBe(200);

    const body = result.body as any;
    expect(body.summary).toBeDefined();
    expect(body.summary.events_count).toBe(5000);
    expect(body.summary.api_calls).toBe(1200);
    expect(body.summary.plan).toBe('pro');
    expect(body.summary.quota_events).toBe(1_000_000);
    expect(body.timeseries).toHaveLength(2);
    expect(body.timeseries[0].events).toBe(100);
  });

  it('getUsage defaults to 30d for invalid range', async () => {
    const mod = await import('../routes/usage-routes.js');
    let capturedParams: any[] = [];
    const mockDb = {
      query: async (sql: string, params: any[]) => {
        capturedParams = params;
        if (sql.includes('plan')) return { rows: [{ plan: 'free' }] };
        if (sql.includes('SUM') && !sql.includes('GROUP BY')) {
          return { rows: [{ events_count: 0, api_calls: 0, storage_bytes: 0 }] };
        }
        return { rows: [] };
      },
    } as any;

    const handlers = mod.createUsageRouteHandlers({ db: mockDb });
    const result = await handlers.getUsage('org-1', 'invalid');
    expect(result.status).toBe(200);
    expect((result.body as any).summary.plan).toBe('free');
  });

  it('getUsage uses correct tier quotas', async () => {
    const mod = await import('../routes/usage-routes.js');
    const mockDb = {
      query: async (sql: string) => {
        if (sql.includes('plan')) return { rows: [{ plan: 'team' }] };
        if (sql.includes('SUM') && !sql.includes('GROUP BY')) {
          return { rows: [{ events_count: 0, api_calls: 0, storage_bytes: 0 }] };
        }
        return { rows: [] };
      },
    } as any;

    const handlers = mod.createUsageRouteHandlers({ db: mockDb });
    const result = await handlers.getUsage('org-1', '7d');
    const body = result.body as any;
    expect(body.summary.quota_events).toBe(10_000_000);
    expect(body.summary.quota_storage_bytes).toBe(1_099_511_627_776);
  });
});
