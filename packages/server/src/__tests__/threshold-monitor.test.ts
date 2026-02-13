/**
 * Tests for ThresholdMonitor (Story 1.2 — Proactive Guardrails Batch 1)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ThresholdMonitor,
  type ThresholdConfig,
  type MetricsFetcher,
  type WebhookPayload,
} from '../lib/threshold-monitor.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.useRealTimers();
});

function createFetcher(values: Record<string, number>): MetricsFetcher {
  return async (metric, window, agentId) => {
    const key = `${metric}:${window}:${agentId ?? '*'}`;
    return values[key] ?? 0;
  };
}

describe('ThresholdMonitor', () => {
  it('fires breach webhook on state transition ok→breached', async () => {
    const threshold: ThresholdConfig = {
      metric: 'error_rate',
      value: 0.1,
      window: '5m',
      webhookUrl: 'https://example.com/hook',
      agentId: 'agent-1',
    };

    const fetcher = createFetcher({ 'error_rate:5m:agent-1': 0.5 });
    const monitor = new ThresholdMonitor([threshold], fetcher, { checkIntervalMs: 1000 });

    await monitor.checkAll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://example.com/hook');
    const payload: WebhookPayload = JSON.parse(opts.body);
    expect(payload.event).toBe('breach');
    expect(payload.metric).toBe('error_rate');
    expect(payload.currentValue).toBe(0.5);
    expect(payload.threshold).toBe(0.1);
    expect(payload.agentId).toBe('agent-1');
    expect(payload.timestamp).toBeTruthy();
  });

  it('fires recovery webhook on state transition breached→ok', async () => {
    const threshold: ThresholdConfig = {
      metric: 'cost',
      value: 100,
      window: '1h',
      webhookUrl: 'https://example.com/hook',
    };

    // First check: breach (value 150 > threshold 100)
    let currentValue = 150;
    const fetcher: MetricsFetcher = async () => currentValue;
    const monitor = new ThresholdMonitor([threshold], fetcher, { checkIntervalMs: 1000 });

    await monitor.checkAll();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0]![1].body).event).toBe('breach');

    // Second check: recovery (value 50 < threshold 100)
    mockFetch.mockClear();
    currentValue = 50;
    await monitor.checkAll();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const payload: WebhookPayload = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(payload.event).toBe('recovery');
    expect(payload.currentValue).toBe(50);
  });

  it('does NOT fire webhook when state stays the same', async () => {
    const threshold: ThresholdConfig = {
      metric: 'latency',
      value: 500,
      window: '15m',
      webhookUrl: 'https://example.com/hook',
    };

    // Value below threshold — stays ok
    const fetcher = createFetcher({ 'latency:15m:*': 200 });
    const monitor = new ThresholdMonitor([threshold], fetcher, { checkIntervalMs: 1000 });

    await monitor.checkAll();
    expect(mockFetch).not.toHaveBeenCalled();

    // Check again — still ok, no webhook
    await monitor.checkAll();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('retries webhook on failure with exponential backoff', async () => {
    const threshold: ThresholdConfig = {
      metric: 'error_rate',
      value: 0.1,
      window: '5m',
      webhookUrl: 'https://example.com/hook',
    };

    // Fail first 2 attempts, succeed on 3rd
    mockFetch
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const fetcher = createFetcher({ 'error_rate:5m:*': 0.5 });
    const monitor = new ThresholdMonitor([threshold], fetcher, { checkIntervalMs: 1000 });

    // Use real timers for retry delays
    vi.useRealTimers();
    await monitor.checkAll();

    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('tracks state per threshold independently', async () => {
    const thresholds: ThresholdConfig[] = [
      { metric: 'error_rate', value: 0.1, window: '5m', webhookUrl: 'https://example.com/hook1' },
      { metric: 'cost', value: 100, window: '1h', webhookUrl: 'https://example.com/hook2' },
    ];

    const fetcher = createFetcher({
      'error_rate:5m:*': 0.5,  // above threshold → breach
      'cost:1h:*': 50,          // below threshold → ok
    });

    const monitor = new ThresholdMonitor(thresholds, fetcher, { checkIntervalMs: 1000 });
    await monitor.checkAll();

    // Only error_rate should fire
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(payload.metric).toBe('error_rate');
    expect(payload.event).toBe('breach');

    expect(monitor.getState(thresholds[0]!)).toBe('breached');
    expect(monitor.getState(thresholds[1]!)).toBe('ok');
  });
});
