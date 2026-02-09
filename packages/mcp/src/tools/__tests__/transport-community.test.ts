/**
 * Tests for community/discovery/delegation transport methods (Story 7.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLensTransport } from '../../transport.js';

describe('AgentLensTransport — Community methods', () => {
  let transport: AgentLensTransport;

  beforeEach(() => {
    transport = new AgentLensTransport({ baseUrl: 'http://localhost:3400', apiKey: 'test-key' });
    vi.stubGlobal('fetch', vi.fn());
  });

  describe('communityShare', () => {
    it('should POST to /api/community/share', async () => {
      const mockResp = { ok: true, json: () => Promise.resolve({ status: 'shared' }) };
      (fetch as any).mockResolvedValue(mockResp);

      await transport.communityShare({ lessonId: 'l1', category: 'general' });
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3400/api/community/share',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
        }),
      );
    });

    it('should send body as JSON', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await transport.communityShare({ lessonId: 'l1' });
      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.lessonId).toBe('l1');
    });
  });

  describe('communitySearch', () => {
    it('should GET /api/community/search with params', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({ lessons: [] }) });
      await transport.communitySearch({ query: 'test', category: 'general' });
      const url = (fetch as any).mock.calls[0][0] as string;
      expect(url).toContain('/api/community/search');
      expect(url).toContain('query=test');
      expect(url).toContain('category=general');
    });
  });

  describe('communityRate', () => {
    it('should POST to /api/community/rate', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await transport.communityRate({ lessonId: 'l1', delta: 1 });
      const call = (fetch as any).mock.calls[0];
      expect(call[0]).toBe('http://localhost:3400/api/community/rate');
      const body = JSON.parse(call[1].body);
      expect(body.delta).toBe(1);
    });
  });

  describe('discover', () => {
    it('should GET /api/discovery with params', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({ results: [] }) });
      await transport.discover({ taskType: 'code-review', minTrustScore: '70' });
      const url = (fetch as any).mock.calls[0][0] as string;
      expect(url).toContain('/api/discovery');
      expect(url).toContain('taskType=code-review');
      expect(url).toContain('minTrustScore=70');
    });
  });

  describe('delegate', () => {
    it('should POST to /api/delegations', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await transport.delegate({ targetAnonymousId: 'anon-1', taskType: 'analysis', input: {} });
      const call = (fetch as any).mock.calls[0];
      expect(call[0]).toBe('http://localhost:3400/api/delegations');
      expect(call[1].method).toBe('POST');
    });

    it('should include all fields in body', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await transport.delegate({
        targetAnonymousId: 'anon-1',
        taskType: 'translation',
        input: { text: 'hello' },
        fallbackEnabled: true,
        maxRetries: 3,
        timeoutMs: 10000,
      });
      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.targetAnonymousId).toBe('anon-1');
      expect(body.fallbackEnabled).toBe(true);
      expect(body.maxRetries).toBe(3);
    });
  });

  describe('auth headers', () => {
    it('should include API key in Authorization header', async () => {
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await transport.communityShare({ lessonId: 'l1' });
      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.Authorization).toBe('Bearer test-key');
    });

    it('should not include Authorization when no API key', async () => {
      const noKeyTransport = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      (fetch as any).mockResolvedValue({ ok: true, json: () => ({}) });
      await noKeyTransport.communityShare({ lessonId: 'l1' });
      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.Authorization).toBeUndefined();
    });
  });
});
