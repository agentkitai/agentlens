/**
 * Notification Router (Feature 12, Story 12.8)
 *
 * Central dispatcher that resolves channel IDs, applies grouping,
 * and routes to the correct provider. Used by both AlertEngine
 * and GuardrailEngine.
 */

import { ulid } from 'ulid';
import type { NotificationPayload, NotificationChannel, DeliveryResult, NotificationLogEntry } from '@agentlensai/core';
import type { NotificationProvider } from './provider.js';
import type { NotificationChannelRepository } from '../../db/repositories/notification-channel-repository.js';
import { WebhookProvider } from './providers/webhook.js';
import { SlackProvider } from './providers/slack.js';
import { PagerDutyProvider } from './providers/pagerduty.js';
import { EmailProvider } from './providers/email.js';
import { GroupingBuffer } from './grouping-buffer.js';
import { isWebhookUrlAllowed } from './ssrf.js';
import { createLogger } from '../logger.js';

const log = createLogger('NotificationRouter');

export class NotificationRouter {
  private providers: Map<string, NotificationProvider>;
  private groupingBuffer: GroupingBuffer;
  private webhookProvider: WebhookProvider;

  constructor(private repo: NotificationChannelRepository) {
    this.webhookProvider = new WebhookProvider();
    this.providers = new Map<string, NotificationProvider>([
      ['webhook', this.webhookProvider],
      ['slack', new SlackProvider()],
      ['pagerduty', new PagerDutyProvider()],
      ['email', new EmailProvider()],
    ]);

    this.groupingBuffer = new GroupingBuffer(
      async (payload, groupCount) => {
        // On group flush, re-dispatch without grouping
        await this.dispatchDirect(payload, payload.metadata._channelEntries as string[] ?? [], payload.metadata._tenantId as string ?? 'default');
      },
    );
  }

  /**
   * Dispatch notifications for the given channel entries.
   * Channel entries can be:
   * - Raw URLs (backward compat) → sent via WebhookProvider inline
   * - Channel IDs (ULIDs) → resolved from DB and routed to correct provider
   */
  async dispatch(
    channelEntries: string[],
    payload: NotificationPayload,
    tenantId: string = 'default',
  ): Promise<DeliveryResult[]> {
    if (channelEntries.length === 0) return [];

    // Apply grouping
    const enrichedPayload = {
      ...payload,
      metadata: { ...payload.metadata, _channelEntries: channelEntries, _tenantId: tenantId },
    };
    const shouldSend = this.groupingBuffer.submit(payload.ruleId, enrichedPayload);
    if (!shouldSend) {
      log.info(`Alert for rule ${payload.ruleId} grouped (suppressed)`);
      return [];
    }

    return this.dispatchDirect(payload, channelEntries, tenantId);
  }

  private async dispatchDirect(
    payload: NotificationPayload,
    channelEntries: string[],
    tenantId: string,
  ): Promise<DeliveryResult[]> {
    const results: DeliveryResult[] = [];

    for (const entry of channelEntries) {
      try {
        if (this.isUrl(entry)) {
          // Backward compat: raw URL → inline webhook
          if (!isWebhookUrlAllowed(entry)) {
            log.warn(`SSRF blocked: ${entry}`);
            continue;
          }
          const result = await this.webhookProvider.sendToUrl(entry, payload);
          results.push(result);
          await this.logResult(result, payload, tenantId, entry);
        } else {
          // Channel ID → resolve and dispatch
          const channel = await this.repo.getChannel(entry, tenantId);
          if (!channel) {
            log.warn(`Notification channel not found: ${entry}`);
            continue;
          }
          if (!channel.enabled) {
            log.info(`Notification channel disabled: ${channel.name} (${entry})`);
            continue;
          }

          const provider = this.providers.get(channel.type);
          if (!provider) {
            log.warn(`No provider for channel type: ${channel.type}`);
            continue;
          }

          const result = await provider.send(channel, payload);
          results.push(result);
          await this.logResult(result, payload, tenantId, channel.id);
        }
      } catch (err) {
        log.error(`Notification dispatch error for ${entry}: ${err}`);
      }
    }

    return results;
  }

  /** Test a specific channel */
  async testChannel(channelId: string, tenantId?: string): Promise<DeliveryResult> {
    const channel = await this.repo.getChannel(channelId, tenantId);
    if (!channel) {
      return { success: false, channelId, channelType: 'webhook', attempt: 1, error: 'Channel not found' };
    }

    const provider = this.providers.get(channel.type);
    if (!provider) {
      return { success: false, channelId, channelType: channel.type, attempt: 1, error: `No provider for type: ${channel.type}` };
    }

    return provider.testSend(channel);
  }

  private async logResult(
    result: DeliveryResult,
    payload: NotificationPayload,
    tenantId: string,
    channelId: string,
  ): Promise<void> {
    try {
      const logEntry: NotificationLogEntry = {
        id: ulid(),
        tenantId,
        channelId,
        ruleId: payload.ruleId,
        ruleType: payload.source,
        status: result.success ? 'success' : 'failed',
        attempt: result.attempt,
        errorMessage: result.error,
        payloadSummary: JSON.stringify({ title: payload.title, severity: payload.severity }).slice(0, 500),
        createdAt: new Date().toISOString(),
      };
      await this.repo.insertLog(logEntry);
    } catch (err) {
      log.error(`Failed to log notification result: ${err}`);
    }
  }

  private isUrl(s: string): boolean {
    return s.startsWith('http://') || s.startsWith('https://');
  }

  stop(): void {
    this.groupingBuffer.stop();
  }
}
