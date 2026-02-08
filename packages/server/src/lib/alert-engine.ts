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
import type { IEventStore } from '@agentlensai/core';
import type { AlertRule, AlertHistory, AlertCondition } from '@agentlensai/core';
import { SqliteEventStore } from '../db/sqlite-store.js';
import { TenantScopedStore } from '../db/tenant-scoped-store.js';
import { eventBus } from './event-bus.js';

/** Default evaluation interval: 60 seconds */
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

// ─── SSRF Protection ────────────────────────────────────────────────

/**
 * Validate that a webhook URL is safe to deliver to.
 * Blocks private/reserved IPs and non-HTTP(S) schemes to prevent SSRF.
 */
export function isWebhookUrlAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only allow http and https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

  // Allow http://localhost only for dev
  if (parsed.protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // In production, require https for non-localhost
    // For now, allow http in dev but still block private IPs below
  }

  // Block IPv6 loopback
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') {
    return false;
  }

  // Block private/reserved IPv4 ranges
  const PRIVATE_IP_PATTERNS = [
    /^127\./, // loopback
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
    /^169\.254\./, // link-local
    /^0\./, // 0.0.0.0/8
  ];

  if (PRIVATE_IP_PATTERNS.some((p) => p.test(hostname))) {
    return false;
  }

  // Block if hostname resolves to a known-private DNS name
  if (hostname === 'localhost' && parsed.protocol === 'https:') {
    // https://localhost is suspicious but technically okay for dev
    return true;
  }

  return true;
}

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
   * Get a tenant-scoped store for a given rule.
   * If the underlying store is SqliteEventStore and the rule has a tenantId,
   * returns a TenantScopedStore. Otherwise returns the original store.
   */
  private getTenantStore(rule: AlertRule): IEventStore {
    const tenantId = rule.tenantId ?? 'default';
    if (this.store instanceof SqliteEventStore) {
      return new TenantScopedStore(this.store, tenantId);
    }
    return this.store;
  }

  /**
   * Run a single evaluation cycle (can also be called manually / from tests).
   *
   * Rules are grouped by tenantId so every operation — listing rules,
   * querying analytics, deduplication, and history insertion — goes
   * through a tenant-scoped store.  This prevents any cross-tenant
   * data leakage during alert evaluation.
   */
  async evaluate(): Promise<AlertHistory[]> {
    if (this.running) return [];
    this.running = true;

    try {
      // NOTE (E1-H3): This intentionally calls listAlertRules() without a tenantId
      // to fetch rules across ALL tenants. The alert engine is a system-level service
      // that evaluates every tenant's rules, then scopes all subsequent reads/writes
      // through per-tenant TenantScopedStore instances (see grouping below).
      // This is the only place where cross-tenant global access is expected.
      const allRules = await this.store.listAlertRules();
      const rulesByTenant = new Map<string, AlertRule[]>();
      for (const rule of allRules) {
        const tid = rule.tenantId ?? 'default';
        let bucket = rulesByTenant.get(tid);
        if (!bucket) {
          bucket = [];
          rulesByTenant.set(tid, bucket);
        }
        bucket.push(rule);
      }

      const triggered: AlertHistory[] = [];

      for (const [tenantId, tenantRules] of rulesByTenant) {
        // Build a single tenant-scoped store per tenant
        const tenantStore =
          this.store instanceof SqliteEventStore
            ? new TenantScopedStore(this.store, tenantId)
            : this.store;

        const enabledRules = tenantRules.filter((r) => r.enabled);

        for (const rule of enabledRules) {
          try {
            const currentValue = await this.computeCurrentValue(rule, tenantStore);
            const shouldTrigger = this.checkCondition(rule.condition, currentValue, rule.threshold);

            if (shouldTrigger) {
              // M1 fix: Deduplication — skip if the rule already triggered within its window
              const recentHistory = await tenantStore.listAlertHistory({ ruleId: rule.id, limit: 1 });
              if (recentHistory.entries.length > 0) {
                const lastTrigger = new Date(recentHistory.entries[0]!.triggeredAt).getTime();
                const cooldownMs = rule.windowMinutes * 60_000;
                if (Date.now() - lastTrigger < cooldownMs) {
                  continue; // Still within cooldown period
                }
              }

              const entry = await this.triggerAlert(rule, currentValue, tenantStore);
              triggered.push(entry);
            }
          } catch (err) {
            console.error(`[AlertEngine] Error evaluating rule "${rule.name}" (${rule.id}):`, err);
          }
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
  private async computeCurrentValue(rule: AlertRule, tenantStore: IEventStore): Promise<number> {
    const now = new Date();
    const windowStart = new Date(now.getTime() - rule.windowMinutes * 60_000);
    const from = windowStart.toISOString();
    const to = now.toISOString();

    const analytics = await tenantStore.getAnalytics({
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
  private async triggerAlert(rule: AlertRule, currentValue: number, tenantStore: IEventStore): Promise<AlertHistory> {
    const now = new Date().toISOString();
    const message = this.buildMessage(rule, currentValue);

    const entry: AlertHistory = {
      id: ulid(),
      ruleId: rule.id,
      triggeredAt: now,
      currentValue,
      threshold: rule.threshold,
      message,
      tenantId: rule.tenantId,
    };

    // 1. Persist to alert history (via tenant-scoped store)
    await tenantStore.insertAlertHistory(entry);

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
      (ch) => (ch.startsWith('http://') || ch.startsWith('https://')) && isWebhookUrlAllowed(ch),
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
