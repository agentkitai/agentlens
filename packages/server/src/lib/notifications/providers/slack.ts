/**
 * Slack notification provider (Feature 12, Story 12.3)
 *
 * Uses Slack Incoming Webhooks with Block Kit formatting.
 */

import type { NotificationPayload, DeliveryResult, NotificationChannel, SlackChannelConfig } from '@agentlensai/core';
import type { NotificationProvider } from '../provider.js';
import { validateExternalUrl } from '../ssrf.js';
import { createLogger } from '../../logger.js';

const log = createLogger('SlackProvider');

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#E01E5A',
  warning: '#ECB22E',
  info: '#36C5F0',
};

export class SlackProvider implements NotificationProvider {
  readonly type = 'slack';

  async send(channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult> {
    const config = channel.config as unknown as SlackChannelConfig;
    const urlCheck = validateExternalUrl(config.webhookUrl);
    if (!urlCheck.valid) {
      return { success: false, channelId: channel.id, channelType: 'slack', attempt: 1, error: urlCheck.reason };
    }

    const blocks = this.buildBlocks(payload);
    const body: Record<string, unknown> = { blocks };
    if (config.channel) body.channel = config.channel;

    // Retry on 429
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(config.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          return { success: true, channelId: channel.id, channelType: 'slack', attempt, httpStatus: res.status };
        }

        if (res.status === 429 && attempt < 3) {
          const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
          await sleep(retryAfter * 1000);
          continue;
        }

        return { success: false, channelId: channel.id, channelType: 'slack', attempt, httpStatus: res.status, error: `HTTP ${res.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < 3) { await sleep(2000); continue; }
        return { success: false, channelId: channel.id, channelType: 'slack', attempt, error: msg };
      }
    }

    return { success: false, channelId: channel.id, channelType: 'slack', attempt: 3, error: 'Max retries' };
  }

  async testSend(channel: NotificationChannel): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      source: 'alert_rule',
      severity: 'info',
      title: '✅ Test Notification',
      message: `AgentLens notification channel "${channel.name}" is working correctly.`,
      metadata: { test: true },
      triggeredAt: new Date().toISOString(),
      ruleId: 'test',
      ruleName: 'Test',
    };
    return this.send(channel, testPayload);
  }

  private buildBlocks(payload: NotificationPayload): unknown[] {
    const color = SEVERITY_COLORS[payload.severity] ?? SEVERITY_COLORS.info;
    const severityEmoji = payload.severity === 'critical' ? '🔴' : payload.severity === 'warning' ? '🟡' : 'ℹ️';

    return [
      {
        type: 'header',
        text: { type: 'plain_text', text: `${severityEmoji} ${payload.title}`, emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: payload.message,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Source:* ${payload.source}` },
          { type: 'mrkdwn', text: `*Severity:* ${payload.severity}` },
          { type: 'mrkdwn', text: `*Rule:* ${payload.ruleName}` },
          ...(payload.agentId ? [{ type: 'mrkdwn', text: `*Agent:* ${payload.agentId}` }] : []),
        ],
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: `Triggered at ${payload.triggeredAt}` },
        ],
      },
      { type: 'divider' },
    ];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
