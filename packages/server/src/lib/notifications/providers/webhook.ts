/**
 * Webhook notification provider (Feature 12, Story 12.2)
 *
 * Backward-compatible with existing webhook delivery + retry with exponential backoff.
 */

import type { NotificationPayload, DeliveryResult, NotificationChannel, WebhookChannelConfig } from '@agentlensai/core';
import type { NotificationProvider } from '../provider.js';
import { validateExternalUrl } from '../ssrf.js';
import { createLogger } from '../../logger.js';

const log = createLogger('WebhookProvider');
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

export class WebhookProvider implements NotificationProvider {
  readonly type = 'webhook';

  async send(channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult> {
    const config = channel.config as unknown as WebhookChannelConfig;
    return this.deliver(channel.id, config, payload);
  }

  async testSend(channel: NotificationChannel): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      source: 'alert_rule',
      severity: 'info',
      title: 'Test Notification',
      message: `This is a test from AgentLens notification channel "${channel.name}"`,
      metadata: { test: true },
      triggeredAt: new Date().toISOString(),
      ruleId: 'test',
      ruleName: 'Test',
    };
    return this.send(channel, testPayload);
  }

  /** Send with inline URL (for backward compat with raw URL notifyChannels) */
  async sendToUrl(url: string, payload: NotificationPayload): Promise<DeliveryResult> {
    const config: WebhookChannelConfig = { url, method: 'POST' };
    return this.deliver('inline', config, payload);
  }

  private async deliver(
    channelId: string,
    config: WebhookChannelConfig,
    payload: NotificationPayload,
  ): Promise<DeliveryResult> {
    const urlCheck = validateExternalUrl(config.url);
    if (!urlCheck.valid) {
      return { success: false, channelId, channelType: 'webhook', attempt: 1, error: urlCheck.reason };
    }

    const method = config.method ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers ?? {}),
    };

    for (let attempt = 1; attempt <= RETRY_DELAYS.length + 1; attempt++) {
      try {
        const res = await fetch(config.url, {
          method,
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          return { success: true, channelId, channelType: 'webhook', attempt, httpStatus: res.status };
        }

        log.warn(`Webhook ${config.url} returned HTTP ${res.status} (attempt ${attempt})`);

        if (attempt <= RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt - 1]!);
          continue;
        }

        return { success: false, channelId, channelType: 'webhook', attempt, httpStatus: res.status, error: `HTTP ${res.status}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Webhook ${config.url} error (attempt ${attempt}): ${msg}`);

        if (attempt <= RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt - 1]!);
          continue;
        }

        return { success: false, channelId, channelType: 'webhook', attempt, error: msg };
      }
    }

    return { success: false, channelId, channelType: 'webhook', attempt: RETRY_DELAYS.length + 1, error: 'Max retries exceeded' };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
