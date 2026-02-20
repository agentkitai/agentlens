/**
 * Unit tests for notification providers (Feature 12)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NotificationPayload, NotificationChannel } from '@agentlensai/core';
import { WebhookProvider } from '../lib/notifications/providers/webhook.js';
import { SlackProvider } from '../lib/notifications/providers/slack.js';
import { PagerDutyProvider } from '../lib/notifications/providers/pagerduty.js';
import { GroupingBuffer } from '../lib/notifications/grouping-buffer.js';
import { validateExternalUrl, isWebhookUrlAllowed } from '../lib/notifications/ssrf.js';

const testPayload: NotificationPayload = {
  source: 'alert_rule',
  severity: 'warning',
  title: 'High Error Rate',
  message: 'Error rate 15% exceeds threshold 10%',
  metadata: { condition: 'error_rate_exceeds' },
  triggeredAt: new Date().toISOString(),
  ruleId: 'rule-1',
  ruleName: 'High Error Rate',
  agentId: 'agent-1',
};

function makeChannel(type: string, config: Record<string, unknown>): NotificationChannel {
  return {
    id: 'ch-1',
    tenantId: 'default',
    type: type as any,
    name: 'Test Channel',
    config,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('SSRF Protection', () => {
  it('blocks private IPs', () => {
    expect(validateExternalUrl('http://10.0.0.1/hook').valid).toBe(false);
    expect(validateExternalUrl('http://192.168.1.1/hook').valid).toBe(false);
    expect(validateExternalUrl('http://172.16.0.1/hook').valid).toBe(false);
    expect(validateExternalUrl('http://169.254.1.1/hook').valid).toBe(false);
    expect(validateExternalUrl('http://localhost/hook').valid).toBe(false);
  });

  it('allows public URLs', () => {
    expect(validateExternalUrl('https://hooks.slack.com/services/xxx').valid).toBe(true);
    expect(validateExternalUrl('https://example.com/webhook').valid).toBe(true);
  });

  it('blocks non-HTTP protocols', () => {
    expect(validateExternalUrl('ftp://example.com').valid).toBe(false);
    expect(validateExternalUrl('file:///etc/passwd').valid).toBe(false);
  });

  it('isWebhookUrlAllowed is backward compat', () => {
    expect(isWebhookUrlAllowed('https://example.com')).toBe(true);
    expect(isWebhookUrlAllowed('http://10.0.0.1')).toBe(false);
  });
});

describe('WebhookProvider', () => {
  const provider = new WebhookProvider();

  it('sends successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('webhook', { url: 'https://example.com/hook' });
    const result = await provider.send(channel, testPayload);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(1);
    expect(mockFetch).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it('retries on failure', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('webhook', { url: 'https://example.com/hook' });
    const result = await provider.send(channel, testPayload);

    expect(result.success).toBe(true);
    expect(result.attempt).toBe(3);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.unstubAllGlobals();
  }, 60000);

  it('fails after max retries', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('webhook', { url: 'https://example.com/hook' });
    const result = await provider.send(channel, testPayload);

    expect(result.success).toBe(false);
    expect(result.attempt).toBe(4);
    expect(mockFetch).toHaveBeenCalledTimes(4);

    vi.unstubAllGlobals();
  }, 60000);

  it('blocks SSRF', async () => {
    const channel = makeChannel('webhook', { url: 'http://10.0.0.1/hook' });
    const result = await provider.send(channel, testPayload);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Private IP');
  });

  it('sends with custom headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('webhook', {
      url: 'https://example.com/hook',
      headers: { 'X-Custom': 'value' },
    });
    await provider.send(channel, testPayload);

    const callHeaders = mockFetch.mock.calls[0]![1]!.headers;
    expect(callHeaders['X-Custom']).toBe('value');

    vi.unstubAllGlobals();
  });
});

describe('SlackProvider', () => {
  const provider = new SlackProvider();

  it('sends Block Kit message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('slack', { webhookUrl: 'https://hooks.slack.com/services/xxx' });
    const result = await provider.send(channel, testPayload);

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
    expect(body.blocks).toBeDefined();
    expect(body.blocks.length).toBeGreaterThan(0);
    expect(body.blocks[0].type).toBe('header');

    vi.unstubAllGlobals();
  });
});

describe('PagerDutyProvider', () => {
  const provider = new PagerDutyProvider();

  it('sends trigger event', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('pagerduty', { routingKey: 'test-key' });
    const result = await provider.send(channel, testPayload);

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
    expect(body.event_action).toBe('trigger');
    expect(body.routing_key).toBe('test-key');
    expect(body.dedup_key).toBe('agentlens:rule-1:agent-1');
    expect(body.payload.severity).toBe('warning');

    vi.unstubAllGlobals();
  });

  it('sends resolve event', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', mockFetch);

    const channel = makeChannel('pagerduty', { routingKey: 'test-key' });
    const result = await provider.sendResolve(channel, 'rule-1', 'agent-1');

    expect(result.success).toBe(true);
    const body = JSON.parse(mockFetch.mock.calls[0]![1]!.body);
    expect(body.event_action).toBe('resolve');
    expect(body.dedup_key).toBe('agentlens:rule-1:agent-1');

    vi.unstubAllGlobals();
  });
});

describe('GroupingBuffer', () => {
  it('sends first alert immediately', () => {
    const flushFn = vi.fn();
    const buffer = new GroupingBuffer(flushFn, 5000);

    const shouldSend = buffer.submit('rule-1', testPayload);
    expect(shouldSend).toBe(true);

    buffer.stop();
  });

  it('suppresses subsequent alerts within window', () => {
    const flushFn = vi.fn();
    const buffer = new GroupingBuffer(flushFn, 5000);

    expect(buffer.submit('rule-1', testPayload)).toBe(true);
    expect(buffer.submit('rule-1', testPayload)).toBe(false);
    expect(buffer.submit('rule-1', testPayload)).toBe(false);

    buffer.stop();
  });

  it('allows different rules independently', () => {
    const flushFn = vi.fn();
    const buffer = new GroupingBuffer(flushFn, 5000);

    expect(buffer.submit('rule-1', testPayload)).toBe(true);
    expect(buffer.submit('rule-2', { ...testPayload, ruleId: 'rule-2' })).toBe(true);

    buffer.stop();
  });
});
