/**
 * Threshold Monitor — detects metric breaches and fires webhooks.
 *
 * Part of the Proactive Guardrails feature (Batch 1, Story 1.2).
 * Monitors configurable metric thresholds and fires webhooks on state transitions
 * (ok→breached or breached→ok) to enable downstream systems (e.g. AgentGate)
 * to tighten/relax approval policies automatically.
 */

import { createLogger } from './logger.js';
import { isWebhookUrlAllowed } from './alert-engine.js';

const log = createLogger('ThresholdMonitor');

// ─── Types ──────────────────────────────────────────────────────────

export type MetricType = 'error_rate' | 'cost' | 'latency';
export type WindowSize = '5m' | '15m' | '1h';
export type ThresholdState = 'ok' | 'breached';

export interface ThresholdConfig {
  metric: MetricType;
  value: number;
  window: WindowSize;
  webhookUrl: string;
  agentId?: string;
}

export interface WebhookPayload {
  event: 'breach' | 'recovery';
  metric: MetricType;
  currentValue: number;
  threshold: number;
  agentId: string | null;
  timestamp: string;
}

/** Function signature for fetching current metric values */
export type MetricsFetcher = (
  metric: MetricType,
  window: WindowSize,
  agentId?: string,
) => Promise<number>;

// ─── ThresholdMonitor ───────────────────────────────────────────────

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1_000;

export class ThresholdMonitor {
  private states: Map<string, ThresholdState> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly checkIntervalMs: number;

  constructor(
    private thresholds: ThresholdConfig[],
    private fetchMetric: MetricsFetcher,
    options?: { checkIntervalMs?: number },
  ) {
    this.checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;

    // Initialize all thresholds to 'ok'
    for (const t of thresholds) {
      this.states.set(this.key(t), 'ok');
    }
  }

  /** Unique key for a threshold config */
  private key(t: ThresholdConfig): string {
    return `${t.metric}:${t.window}:${t.agentId ?? '*'}`;
  }

  /** Start periodic checking */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.checkAll(), this.checkIntervalMs);
    this.timer.unref();
    log.info(`ThresholdMonitor started (${this.thresholds.length} thresholds, ${this.checkIntervalMs}ms interval)`);
  }

  /** Stop periodic checking */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Get current state for a threshold */
  getState(t: ThresholdConfig): ThresholdState {
    return this.states.get(this.key(t)) ?? 'ok';
  }

  /** Check all thresholds once */
  async checkAll(): Promise<void> {
    await Promise.allSettled(this.thresholds.map((t) => this.checkOne(t)));
  }

  /** Check a single threshold */
  private async checkOne(t: ThresholdConfig): Promise<void> {
    try {
      const currentValue = await this.fetchMetric(t.metric, t.window, t.agentId);
      const k = this.key(t);
      const prevState = this.states.get(k) ?? 'ok';
      const newState: ThresholdState = currentValue > t.value ? 'breached' : 'ok';

      if (prevState !== newState) {
        this.states.set(k, newState);
        const payload: WebhookPayload = {
          event: newState === 'breached' ? 'breach' : 'recovery',
          metric: t.metric,
          currentValue,
          threshold: t.value,
          agentId: t.agentId ?? null,
          timestamp: new Date().toISOString(),
        };

        log.info(`Threshold ${newState}: ${t.metric} = ${currentValue} (threshold: ${t.value})`);
        await this.fireWebhook(t.webhookUrl, payload);
      }
    } catch (err) {
      log.error(`Failed to check threshold ${t.metric}: ${err}`);
    }
  }

  /** Fire webhook with 3x retry and exponential backoff */
  async fireWebhook(url: string, payload: WebhookPayload): Promise<void> {
    if (!isWebhookUrlAllowed(url)) {
      log.error(`Webhook URL blocked by SSRF protection: ${url}`);
      return;
    }

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          return;
        }

        log.warn(`Webhook attempt ${attempt + 1} failed: HTTP ${res.status}`);
      } catch (err) {
        log.warn(`Webhook attempt ${attempt + 1} error: ${err}`);
      }

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    log.error(`Webhook delivery failed after ${MAX_RETRIES} attempts: ${url}`);
  }
}
