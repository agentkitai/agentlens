/**
 * PagerDuty notification provider (Feature 12, Story 12.4)
 *
 * Uses PagerDuty Events API v2.
 */

import type { NotificationPayload, DeliveryResult, NotificationChannel, PagerDutyChannelConfig } from '@agentlensai/core';
import type { NotificationProvider } from '../provider.js';
import { createLogger } from '../../logger.js';

const log = createLogger('PagerDutyProvider');
const PD_EVENTS_URL = 'https://events.pagerduty.com/v2/enqueue';

export class PagerDutyProvider implements NotificationProvider {
  readonly type = 'pagerduty';

  async send(channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult> {
    const config = channel.config as unknown as PagerDutyChannelConfig;
    const dedupKey = `agentlens:${payload.ruleId}:${payload.agentId ?? 'global'}`;

    const pdPayload = {
      routing_key: config.routingKey,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[AgentLens] ${payload.title}: ${payload.message}`,
        source: `agentlens`,
        severity: this.mapSeverity(payload.severity, config.severityMap),
        timestamp: payload.triggeredAt,
        component: payload.agentId ?? 'agentlens',
        group: payload.source,
        class: payload.ruleName,
        custom_details: payload.metadata,
      },
    };

    try {
      const res = await fetch(PD_EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pdPayload),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        return { success: true, channelId: channel.id, channelType: 'pagerduty', attempt: 1, httpStatus: res.status };
      }

      const text = await res.text().catch(() => '');
      return { success: false, channelId: channel.id, channelType: 'pagerduty', attempt: 1, httpStatus: res.status, error: text || `HTTP ${res.status}` };
    } catch (err) {
      return { success: false, channelId: channel.id, channelType: 'pagerduty', attempt: 1, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Send a resolve event for auto-resolution (PD-3) */
  async sendResolve(channel: NotificationChannel, ruleId: string, agentId?: string): Promise<DeliveryResult> {
    const config = channel.config as unknown as PagerDutyChannelConfig;
    const dedupKey = `agentlens:${ruleId}:${agentId ?? 'global'}`;

    try {
      const res = await fetch(PD_EVENTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routing_key: config.routingKey,
          event_action: 'resolve',
          dedup_key: dedupKey,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      return {
        success: res.ok,
        channelId: channel.id,
        channelType: 'pagerduty',
        attempt: 1,
        httpStatus: res.status,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      return { success: false, channelId: channel.id, channelType: 'pagerduty', attempt: 1, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async testSend(channel: NotificationChannel): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      source: 'alert_rule',
      severity: 'info',
      title: 'Test Notification',
      message: `AgentLens channel "${channel.name}" test`,
      metadata: { test: true },
      triggeredAt: new Date().toISOString(),
      ruleId: 'test',
      ruleName: 'Test',
    };
    return this.send(channel, testPayload);
  }

  private mapSeverity(severity: string, severityMap?: Record<string, string>): string {
    if (severityMap?.[severity]) return severityMap[severity]!;
    // PD accepts: critical, error, warning, info
    return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
  }
}
