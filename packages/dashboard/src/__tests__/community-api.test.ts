/**
 * Tests for Community/Discovery/Delegation API client functions (Stories 7.2, 7.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// Dynamic import to get fresh module with mocked fetch
let api: typeof import('../api/client');

beforeEach(async () => {
  mockFetch.mockReset();
  api = await import('../api/client');
});

describe('Community API', () => {
  describe('getSharingConfig', () => {
    it('should fetch sharing config', async () => {
      const config = { tenantId: 't1', enabled: true };
      mockFetch.mockResolvedValue(mockJsonResponse(config));
      const result = await api.getSharingConfig();
      expect(result).toEqual(config);
      expect(mockFetch).toHaveBeenCalledWith('/api/community/config', expect.objectContaining({ headers: expect.any(Object) }));
    });
  });

  describe('updateSharingConfig', () => {
    it('should PUT sharing config updates', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ tenantId: 't1', enabled: false }));
      await api.updateSharingConfig({ enabled: false });
      expect(mockFetch).toHaveBeenCalledWith('/api/community/config', expect.objectContaining({ method: 'PUT' }));
    });
  });

  describe('getAgentSharingConfigs', () => {
    it('should fetch agent configs', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ configs: [{ agentId: 'a1', enabled: true }] }));
      const result = await api.getAgentSharingConfigs();
      expect(result.configs).toHaveLength(1);
    });
  });

  describe('getDenyList', () => {
    it('should fetch deny list rules', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ rules: [] }));
      const result = await api.getDenyList();
      expect(result.rules).toEqual([]);
    });
  });

  describe('addDenyListRule', () => {
    it('should POST a new deny rule', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ id: 'r1', pattern: 'secret', isRegex: false, reason: 'test' }));
      const result = await api.addDenyListRule({ pattern: 'secret', isRegex: false, reason: 'test' });
      expect(result.id).toBe('r1');
    });
  });

  describe('deleteDenyListRule', () => {
    it('should DELETE a deny rule', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ ok: true }));
      await api.deleteDenyListRule('r1');
      expect(mockFetch).toHaveBeenCalledWith('/api/community/deny-list/r1', expect.objectContaining({ method: 'DELETE' }));
    });
  });

  describe('communitySearch', () => {
    it('should search with query params', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ lessons: [], total: 0 }));
      await api.communitySearch({ query: 'test', category: 'general', minReputation: 50, limit: 10 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('query=test');
      expect(url).toContain('category=general');
      expect(url).toContain('minReputation=50');
    });

    it('should return lessons', async () => {
      const lessons = [{ id: 'l1', title: 'Test', category: 'general', content: 'x', reputationScore: 50 }];
      mockFetch.mockResolvedValue(mockJsonResponse({ lessons, total: 1 }));
      const result = await api.communitySearch({ query: 'test' });
      expect(result.lessons).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('communityRate', () => {
    it('should POST a rating', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ status: 'rated', reputationScore: 55 }));
      const result = await api.communityRate('l1', 1);
      expect(result.reputationScore).toBe(55);
    });
  });

  describe('getSharingAuditLog', () => {
    it('should fetch audit events', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ events: [], total: 0 }));
      await api.getSharingAuditLog({ eventType: 'share', limit: 50 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('eventType=share');
    });
  });

  describe('killSwitchPurge', () => {
    it('should POST purge confirmation', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ status: 'purged', deleted: 10 }));
      const result = await api.killSwitchPurge('CONFIRM_PURGE');
      expect(result.deleted).toBe(10);
    });
  });

  describe('getSharingStats', () => {
    it('should fetch sharing stats', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ countShared: 42, lastShared: '2026-01-01', auditSummary: {} }));
      const result = await api.getSharingStats();
      expect(result.countShared).toBe(42);
    });
  });
});

describe('Discovery API', () => {
  describe('getCapabilities', () => {
    it('should fetch capabilities', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ capabilities: [] }));
      const result = await api.getCapabilities();
      expect(result.capabilities).toEqual([]);
    });

    it('should filter by taskType', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ capabilities: [] }));
      await api.getCapabilities({ taskType: 'code-review' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('taskType=code-review');
    });

    it('should filter by agentId', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ capabilities: [] }));
      await api.getCapabilities({ agentId: 'agent-1' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('agentId=agent-1');
    });
  });

  describe('registerCapability', () => {
    it('should POST new capability', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ id: 'cap-1', taskType: 'analysis' }));
      const result = await api.registerCapability({ taskType: 'analysis' });
      expect(result.id).toBe('cap-1');
      expect(mockFetch).toHaveBeenCalledWith('/api/capabilities', expect.objectContaining({ method: 'POST' }));
    });
  });

  describe('updateCapability', () => {
    it('should PUT capability updates', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ id: 'cap-1', enabled: false }));
      await api.updateCapability('cap-1', { enabled: false });
      expect(mockFetch).toHaveBeenCalledWith('/api/capabilities/cap-1', expect.objectContaining({ method: 'PUT' }));
    });
  });

  describe('discoverAgents', () => {
    it('should search for agents', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ results: [{ anonymousAgentId: 'a1', taskType: 'code-review', trustScorePercentile: 85 }] }));
      const result = await api.discoverAgents({ taskType: 'code-review', minTrustScore: 70 });
      expect(result.results).toHaveLength(1);
    });

    it('should pass all params', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ results: [] }));
      await api.discoverAgents({ taskType: 'analysis', minTrustScore: 60, maxCostUsd: 0.5, maxLatencyMs: 5000, limit: 5 });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('taskType=analysis');
      expect(url).toContain('minTrustScore=60');
    });
  });
});

describe('Delegation API', () => {
  describe('getDelegations', () => {
    it('should fetch delegations', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ delegations: [], total: 0 }));
      const result = await api.getDelegations();
      expect(result.delegations).toEqual([]);
    });

    it('should filter by direction', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ delegations: [], total: 0 }));
      await api.getDelegations({ direction: 'inbound' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('direction=inbound');
    });

    it('should filter by status', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ delegations: [], total: 0 }));
      await api.getDelegations({ status: 'completed' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('status=completed');
    });

    it('should filter by date range', async () => {
      mockFetch.mockResolvedValue(mockJsonResponse({ delegations: [], total: 0 }));
      await api.getDelegations({ from: '2026-01-01', to: '2026-01-31' });
      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('from=2026-01-01');
      expect(url).toContain('to=2026-01-31');
    });

    it('should return delegation data', async () => {
      const delegations = [{
        id: 'd1', tenantId: 't1', direction: 'outbound', agentId: 'a1',
        taskType: 'code-review', status: 'completed', executionTimeMs: 1500,
        createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z',
      }];
      mockFetch.mockResolvedValue(mockJsonResponse({ delegations, total: 1 }));
      const result = await api.getDelegations();
      expect(result.delegations[0].executionTimeMs).toBe(1500);
    });
  });
});

describe('API error handling', () => {
  it('should throw ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('Not found'), json: () => Promise.reject() });
    await expect(api.getSharingConfig()).rejects.toThrow();
  });

  it('should include status in error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Internal Server Error'), json: () => Promise.reject() });
    try {
      await api.getCapabilities();
    } catch (e: any) {
      expect(e.message).toContain('Internal Server Error');
    }
  });
});
