/**
 * Alert Evaluation Engine (Story 12.2 + 12.3)
 *
 * Periodically evaluates alert rules against recent analytics data.
 * When conditions are met, triggers alerts:
 *   1. Stores in alertHistory table
 *   2. Delivers via webhook (Story 12.3)
 *   3. Emits on EventBus (Story 12.5)
 *   4. Logs to console
 */

import { ulid } from 'ulid';
import type { IEventStore } from '@agentlens/core';
import type { AlertRule, AlertHistory, AlertCondition } from '@agentlens/core';
import { eventBus } from './event-bus.js';

/** Default evaluation interval: 60 seconds */
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

export interface AlertEngineOptions {
  /** Evaluation interval in milliseconds */
  checkIntervalMs?: number;
}

export class AlertEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly checkIntervalMs: number;

  constructor(
    private store: IEventStore,
    options?: AlertEngineOptions,
  ) {
    this.checkIntervalMs =
      options?.checkIntervalMs ??
      (parseInt(process.env['ALERT_CHECK_INTERVAL_MS'] ?? '', 10) ||
      DEFAULT_CHECK_INTERVAL_MS);
  }

  /**
   * Start the periodic evaluation loop.
   */
  start(): void {
    if (this.timer) return;
    console.log(`[AlertEngine] Starting evaluation loop (interval: ${this.checkIntervalMs}ms)`);
    this.timer = setInterval(() => {
      this.evaluate().catch((err) => {
        console.error('[AlertEngine] Evaluation error:', err);
      });
    }, this.checkIntervalMs);
  }

  /**
   * Stop the evaluation loop.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[AlertEngine] Stopped');
    }
  }

  /**
   * Run a single evaluation cycle (can also be called manually / from tests).
   */
  async evaluate(): Promise<AlertHistory[]> {
    if (this.running) return [];
    this.running = true;

    try {
      const rules = await this.store.listAlertRules();
      const enabledRules = rules.filter((r) => r.enabled);
      const triggered: AlertHistory[] = [];

      for (const rule of enabledRules) {
        try {
          const currentValue = await this.computeCurrentValue(rule);
          const shouldTrigger = this.checkCondition(rule.condition, currentValue, rule.threshold);

          if (shouldTrigger) {
            const entry = await this.triggerAlert(rule, currentValue);
            triggered.push(entry);
          }
        } catch (err) {
          console.error(`[AlertEngine] Error evaluating rule "${rule.name}" (${rule.id}):`, err);
        }
      }

      return triggered;
    } finally {
      this.running = false;
    }
  }

  /**
   * Compute the current metric value for a rule by querying analytics.
   */
  private async computeCurrentValue(rule: AlertRule): Promise<number> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - rule.windowMinutes * 60_000);
    const from = windowStart.toISOString();
    const to = now.toISOString();

    const analytics = await this.store.getAnalytics({
      from,
      to,
      agentId: rule.scope.agentId,
      granularity: 'hour',
    });

    const totals = analytics.totals;

    switch (rule.condition) {
      case 'error_rate_exceeds': {
        if (totals.eventCount === 0) return 0;
        return totals.errorCount / totals.eventCount;
      }
      case 'cost_exceeds': {
        return totals.totalCostUsd;
      }
      case 'latency_exceeds': {
        return totals.avgLatencyMs;
      }
      case 'event_count_exceeds': {
        return totals.eventCount;
      }
      case 'no_events_for': {
        // For no_events_for, the "value" is the number of events.
        // Trigger if event count is 0 (or below threshold — threshold is ignored,
        // the rule triggers when there are zero events in the window).
        return totals.eventCount;
      }
      default:
        return 0;
    }
  }

  /**
   * Check whether the condition is met.
   */
  private checkCondition(
    condition: AlertCondition,
    currentValue: number,
    threshold: number,
  ): boolean {
    switch (condition) {
      case 'error_rate_exceeds':
      case 'cost_exceeds':
      case 'latency_exceeds':
      case 'event_count_exceeds':
        return currentValue > threshold;

      case 'no_events_for':
        // Triggers when event count is 0 (no events in window)
        return currentValue === 0;

      default:
        return false;
    }
  }

  /**
   * Trigger an alert: persist history, deliver webhooks, emit on EventBus.
   */
  private async triggerAlert(rule: AlertRule, currentValue: number): Promise<AlertHistory> {
    const now = new Date().toISOString();
    const message = this.buildMessage(rule, currentValue);

    const entry: AlertHistory = {
      id: ulid(),
      ruleId: rule.id,
      triggeredAt: now,
      currentValue,
      threshold: rule.threshold,
      message,
    };

    // 1. Persist to alert history
    await this.store.insertAlertHistory(entry);

    // 2. Console log
    console.log(`[AlertEngine] 🔔 Alert triggered: "${rule.name}" — ${message}`);

    // 3. Emit on EventBus (Story 12.5)
    eventBus.emit({
      type: 'alert_triggered',
      rule,
      history: entry,
      timestamp: now,
    });

    // 4. Webhook delivery (Story 12.3) — fire and forget
    await this.deliverWebhooks(rule, entry);

    return entry;
  }

  /**
   * Deliver alert to configured webhook URLs (Story 12.3).
   */
  private async deliverWebhooks(rule: AlertRule, entry: AlertHistory): Promise<void> {
    const webhookUrls = rule.notifyChannels.filter(
      (ch) => ch.startsWith('http://') || ch.startsWith('https://'),
    );

    if (webhookUrls.length === 0) return;

    const payload = {
      alertRuleId: rule.id,
      alertName: rule.name,
      condition: rule.condition,
      currentValue: entry.currentValue,
      threshold: entry.threshold,
      message: entry.message,
      triggeredAt: entry.triggeredAt,
      windowMinutes: rule.windowMinutes,
      scope: rule.scope,
    };

    for (const url of webhookUrls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000), // 10s timeout
        });

        if (!res.ok) {
          console.warn(
            `[AlertEngine] Webhook delivery to ${url} failed: HTTP ${res.status}`,
          );
        } else {
          console.log(`[AlertEngine] Webhook delivered to ${url}`);
        }
      } catch (err) {
        console.warn(
          `[AlertEngine] Webhook delivery to ${url} error:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /**
   * Build a human-readable alert message.
   */
  private buildMessage(rule: AlertRule, currentValue: number): string {
    const formatted = (v: number) =>
      Number.isInteger(v) ? v.toString() : v.toFixed(4);

    switch (rule.condition) {
      case 'error_rate_exceeds':
        return `Error rate ${(currentValue * 100).toFixed(1)}% exceeds threshold ${(rule.threshold * 100).toFixed(1)}% in the last ${rule.windowMinutes}m`;
      case 'cost_exceeds':
        return `Cost $${formatted(currentValue)} exceeds threshold $${formatted(rule.threshold)} in the last ${rule.windowMinutes}m`;
      case 'latency_exceeds':
        return `Average latency ${formatted(currentValue)}ms exceeds threshold ${formatted(rule.threshold)}ms in the last ${rule.windowMinutes}m`;
      case 'event_count_exceeds':
        return `Event count ${formatted(currentValue)} exceeds threshold ${formatted(rule.threshold)} in the last ${rule.windowMinutes}m`;
      case 'no_events_for':
        return `No events received in the last ${rule.windowMinutes}m`;
      default:
        return `Alert condition met: ${rule.condition}`;
    }
  }
}
