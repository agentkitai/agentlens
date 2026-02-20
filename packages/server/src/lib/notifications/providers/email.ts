/**
 * Email notification provider (Feature 12, Story 12.5)
 *
 * Uses nodemailer for SMTP delivery with HTML templates.
 */

import type { NotificationPayload, DeliveryResult, NotificationChannel, EmailChannelConfig } from '@agentlensai/core';
import type { NotificationProvider } from '../provider.js';
import { createLogger } from '../../logger.js';

const log = createLogger('EmailProvider');

export class EmailProvider implements NotificationProvider {
  readonly type = 'email';

  async send(channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult> {
    const config = channel.config as unknown as EmailChannelConfig;

    try {
      // Dynamic import to avoid hard dependency if nodemailer not installed
      let nodemailer: any;
      try {
        nodemailer = await Function('return import("nodemailer")')();
      } catch {
        return { success: false, channelId: channel.id, channelType: 'email', attempt: 1, error: 'nodemailer not installed' };
      }
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure ?? config.smtpPort === 465,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
      });

      const html = this.buildHtml(payload);

      await transporter.sendMail({
        from: config.from,
        to: config.to.join(', '),
        subject: `[AgentLens ${payload.severity.toUpperCase()}] ${payload.title}`,
        html,
      });

      return { success: true, channelId: channel.id, channelType: 'email', attempt: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Email send failed: ${msg}`);
      return { success: false, channelId: channel.id, channelType: 'email', attempt: 1, error: msg };
    }
  }

  async testSend(channel: NotificationChannel): Promise<DeliveryResult> {
    const testPayload: NotificationPayload = {
      source: 'alert_rule',
      severity: 'info',
      title: 'Test Notification',
      message: `AgentLens notification channel "${channel.name}" is working correctly.`,
      metadata: { test: true },
      triggeredAt: new Date().toISOString(),
      ruleId: 'test',
      ruleName: 'Test',
    };
    return this.send(channel, testPayload);
  }

  private buildHtml(payload: NotificationPayload): string {
    const severityColors: Record<string, string> = {
      critical: '#E01E5A',
      warning: '#ECB22E',
      info: '#36C5F0',
    };
    const color = severityColors[payload.severity] ?? '#36C5F0';

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <div style="background: ${color}; color: white; padding: 16px 24px;">
      <h2 style="margin: 0; font-size: 18px;">${payload.title}</h2>
    </div>
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px; font-size: 14px; color: #333;">${payload.message}</p>
      <table style="width: 100%; font-size: 13px; color: #666;">
        <tr><td style="padding: 4px 0;"><strong>Source:</strong></td><td>${payload.source}</td></tr>
        <tr><td style="padding: 4px 0;"><strong>Severity:</strong></td><td>${payload.severity}</td></tr>
        <tr><td style="padding: 4px 0;"><strong>Rule:</strong></td><td>${payload.ruleName}</td></tr>
        ${payload.agentId ? `<tr><td style="padding: 4px 0;"><strong>Agent:</strong></td><td>${payload.agentId}</td></tr>` : ''}
        <tr><td style="padding: 4px 0;"><strong>Triggered:</strong></td><td>${payload.triggeredAt}</td></tr>
      </table>
    </div>
    <div style="padding: 12px 24px; background: #f9f9f9; font-size: 12px; color: #999; text-align: center;">
      Sent by AgentLens Notification System
    </div>
  </div>
</body>
</html>`;
  }
}
