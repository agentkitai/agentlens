/**
 * Tests for AgentLensClient (Story 13.1)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLensClient } from '../client.js';
import {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
} from '../errors.js';

// ─── Helpers ────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response);
}

function createClient(fetchFn: typeof globalThis.fetch) {
  return new AgentLensClient({
    url: 'http://localhost:3400',
    apiKey: 'als_test123',
    fetch: fetchFn,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('AgentLensClient', () => {
  describe('constructor', () => {
    it('strips trailing slash from URL', () => {
      const fn = mockFetch(200, { events: [], total: 0, hasMore: false });
      const client = new AgentLensClient({ url: 'http://localhost:3400/', fetch: fn });
      client.queryEvents();
      expect(fn).toHaveBeenCalledWith(
        expect.stringMatching(/^http:\/\/localhost:3400\/api/),
        expect.anything(),
      );
    });
  });

  describe('queryEvents', () => {
    it('returns typed EventQueryResult', async () => {
      const expected = { events: [], total: 0, hasMore: false };
      const fn = mockFetch(200, expected);
      const client = createClient(fn);

      const result = await client.queryEvents();
      expect(result).toEqual(expected);
    });

    it('sends correct query params', async () => {
      const fn = mockFetch(200, { events: [], total: 0, hasMore: false });
      const client = createClient(fn);

      await client.queryEvents({
        sessionId: 'ses_abc',
        eventType: 'tool_call',
        limit: 10,
        order: 'asc',
      });

      const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(url).toContain('sessionId=ses_abc');
      expect(url).toContain('eventType=tool_call');
      expect(url).toContain('limit=10');
      expect(url).toContain('order=asc');
    });

    it('handles array eventType', async () => {
      const fn = mockFetch(200, { events: [], total: 0, hasMore: false });
      const client = createClient(fn);

      await client.queryEvents({ eventType: ['tool_call', 'tool_error'] });

      const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(url).toContain('eventType=tool_call%2Ctool_error');
    });

    it('sends Authorization header with apiKey', async () => {
      const fn = mockFetch(200, { events: [], total: 0, hasMore: false });
      const client = createClient(fn);

      await client.queryEvents();

      const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
      expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer als_test123');
    });
  });

  describe('getEvent', () => {
    it('returns a single event', async () => {
      const event = { id: 'ev_1', eventType: 'tool_call', sessionId: 'ses_abc' };
      const fn = mockFetch(200, event);
      const client = createClient(fn);

      const result = await client.getEvent('ev_1');
      expect(result.id).toBe('ev_1');
    });

    it('throws NotFoundError for 404', async () => {
      const fn = mockFetch(404, { error: 'Event not found' });
      const client = createClient(fn);

      await expect(client.getEvent('ev_missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getSessions', () => {
    it('returns typed SessionQueryResult', async () => {
      const expected = { sessions: [], total: 0, hasMore: false };
      const fn = mockFetch(200, expected);
      const client = createClient(fn);

      const result = await client.getSessions();
      expect(result).toEqual(expected);
    });

    it('sends status and agent filters', async () => {
      const fn = mockFetch(200, { sessions: [], total: 0, hasMore: false });
      const client = createClient(fn);

      await client.getSessions({ status: 'error', agentId: 'agent-1' });

      const url = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
      expect(url).toContain('status=error');
      expect(url).toContain('agentId=agent-1');
    });
  });

  describe('getSession', () => {
    it('returns a single session', async () => {
      const session = { id: 'ses_abc', status: 'active' };
      const fn = mockFetch(200, session);
      const client = createClient(fn);

      const result = await client.getSession('ses_abc');
      expect(result.id).toBe('ses_abc');
    });
  });

  describe('getSessionTimeline', () => {
    it('returns timeline with chain validity', async () => {
      const expected = { events: [], chainValid: true };
      const fn = mockFetch(200, expected);
      const client = createClient(fn);

      const result = await client.getSessionTimeline('ses_abc');
      expect(result.chainValid).toBe(true);
      expect(result.events).toEqual([]);
    });
  });

  describe('health', () => {
    it('does not send Authorization header', async () => {
      const fn = mockFetch(200, { status: 'ok', version: '0.1.0' });
      const client = createClient(fn);

      await client.health();

      const opts = (fn as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
      expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws AuthenticationError for 401', async () => {
      const fn = mockFetch(401, { error: 'Invalid API key' });
      const client = createClient(fn);

      await expect(client.queryEvents()).rejects.toThrow(AuthenticationError);
    });

    it('throws ValidationError for 400', async () => {
      const fn = mockFetch(400, { error: 'Validation failed', details: [{ path: 'limit', message: 'too big' }] });
      const client = createClient(fn);

      await expect(client.queryEvents()).rejects.toThrow(ValidationError);
    });

    it('throws AgentLensError for other HTTP errors', async () => {
      const fn = mockFetch(500, { error: 'Internal server error' });
      const client = createClient(fn);

      await expect(client.queryEvents()).rejects.toThrow(AgentLensError);
    });

    it('throws ConnectionError when fetch rejects', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = createClient(fn);

      await expect(client.queryEvents()).rejects.toThrow(ConnectionError);
    });

    it('ConnectionError includes the original error message', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const client = createClient(fn);

      try {
        await client.queryEvents();
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectionError);
        expect((err as ConnectionError).message).toContain('ECONNREFUSED');
      }
    });
  });
});
