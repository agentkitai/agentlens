/**
 * Notification types for Feature 12 — Notification Integrations
 */

export type NotificationChannelType = 'webhook' | 'slack' | 'pagerduty' | 'email';

export interface NotificationChannel {
  id: string;
  tenantId: string;
  type: NotificationChannelType;
  name: string;
  /** Type-specific config (stored encrypted at rest) */
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookChannelConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
}

export interface SlackChannelConfig {
  webhookUrl: string;
  channel?: string;
}

export interface PagerDutyChannelConfig {
  routingKey: string;
  severityMap?: Record<string, string>;
}

export interface EmailChannelConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  from: string;
  to: string[];
}

export type NotificationSource = 'alert_rule' | 'guardrail';
export type NotificationSeverity = 'info' | 'warning' | 'critical';

export interface NotificationPayload {
  source: NotificationSource;
  severity: NotificationSeverity;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  triggeredAt: string;
  ruleId: string;
  ruleName: string;
  agentId?: string;
}

export interface NotificationLogEntry {
  id: string;
  tenantId: string;
  channelId: string;
  ruleId?: string;
  ruleType?: NotificationSource;
  status: 'success' | 'failed' | 'retrying';
  attempt: number;
  errorMessage?: string;
  payloadSummary?: string;
  createdAt: string;
}

export interface DeliveryResult {
  success: boolean;
  channelId: string;
  channelType: NotificationChannelType;
  attempt: number;
  error?: string;
  httpStatus?: number;
}
