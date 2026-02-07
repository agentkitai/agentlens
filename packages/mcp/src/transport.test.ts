/**
 * Tests for AgentLensTransport (Story 5.6)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLensTransport } from './transport.js';

// Mock global fetch
const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okResponse(data: unknown = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

describe('AgentLensTransport', () => {
  describe('constructor', () => {
    it('strips trailing slashes from baseUrl', () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400///' });
      // Verified indirectly via sendEventImmediate call
      mockFetch.mockResolvedValue(okResponse());
      void t.sendEventImmediate({
        sessionId: 's1',
        agentId: 'a1',
        eventType: 'custom',
        payload: {},
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3400/api/events',
        expect.anything(),
      );
    });
  });

  describe('sendEventImmediate', () => {
    it('sends a POST to /api/events with correct headers and wraps event in batch format', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'evt_1' }));

      const t = new AgentLensTransport({
        baseUrl: 'http://localhost:3400',
        apiKey: 'test-key',
      });

      const event = {
        sessionId: 'ses_123',
        agentId: 'agent_1',
        eventType: 'session_started',
        payload: { agentName: 'Test' },
      };

      const resp = await t.sendEventImmediate(event);
      expect(resp.ok).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3400/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key',
        },
        body: JSON.stringify({ events: [event] }),
      });
    });

    it('omits Authorization header when no apiKey', async () => {
      mockFetch.mockResolvedValue(okResponse());

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.sendEventImmediate({
        sessionId: 's',
        agentId: 'a',
        eventType: 'custom',
        payload: {},
      });

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers).not.toHaveProperty('Authorization');
    });
  });

  describe('queryEvents', () => {
    it('sends a GET with query parameters', async () => {
      mockFetch.mockResolvedValue(okResponse({ events: [] }));

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.queryEvents({ sessionId: 'ses_123', limit: 10, eventType: 'tool_call' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('/api/events?');
      expect(url).toContain('sessionId=ses_123');
      expect(url).toContain('limit=10');
      expect(url).toContain('eventType=tool_call');
    });

    it('omits optional params when not provided', async () => {
      mockFetch.mockResolvedValue(okResponse({ events: [] }));

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.queryEvents({ sessionId: 'ses_123' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('sessionId=ses_123');
      expect(url).not.toContain('limit=');
      expect(url).not.toContain('eventType=');
    });
  });

  describe('session-agent mapping', () => {
    it('stores and retrieves agentId for a session', () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      t.setSessionAgent('ses_123', 'agent-1');
      expect(t.getSessionAgent('ses_123')).toBe('agent-1');
    });

    it('returns empty string for unknown sessions', () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      expect(t.getSessionAgent('unknown')).toBe('');
    });

    it('clears session mapping', () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      t.setSessionAgent('ses_123', 'agent-1');
      t.clearSessionAgent('ses_123');
      expect(t.getSessionAgent('ses_123')).toBe('');
    });
  });

  describe('buffering and flush', () => {
    it('buffers events via sendEvents', async () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });

      await t.sendEvents([
        { sessionId: 's', agentId: 'a', eventType: 'custom', payload: { x: 1 } },
      ]);

      expect(t.bufferedCount).toBe(1);
      expect(t.bufferedBytes).toBeGreaterThan(0);
      // No fetch call yet (below threshold)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('flushes buffered events to /api/events', async () => {
      mockFetch.mockResolvedValue(okResponse());

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400', apiKey: 'key' });
      await t.sendEvents([
        { sessionId: 's', agentId: 'a', eventType: 'custom', payload: { x: 1 } },
        { sessionId: 's', agentId: 'a', eventType: 'custom', payload: { x: 2 } },
      ]);

      await t.flush();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:3400/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer key',
        },
        body: expect.stringContaining('"events"'),
      });

      expect(t.bufferedCount).toBe(0);
    });

    it('re-buffers events on flush failure', async () => {
      mockFetch.mockResolvedValue(errorResponse(500, 'Server error'));

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.sendEvents([
        { sessionId: 's', agentId: 'a', eventType: 'custom', payload: { x: 1 } },
      ]);

      await t.flush();

      // Events should be re-buffered
      expect(t.bufferedCount).toBe(1);
    });

    it('re-buffers events on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network unreachable'));

      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.sendEvents([
        { sessionId: 's', agentId: 'a', eventType: 'custom', payload: { x: 1 } },
      ]);

      await t.flush();

      expect(t.bufferedCount).toBe(1);
    });

    it('does not flush when buffer is empty', async () => {
      const t = new AgentLensTransport({ baseUrl: 'http://localhost:3400' });
      await t.flush();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
