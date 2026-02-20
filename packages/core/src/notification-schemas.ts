/**
 * Zod schemas for notification channel CRUD (Feature 12)
 */
import { z } from 'zod';

export const notificationChannelTypeSchema = z.enum(['webhook', 'slack', 'pagerduty', 'email']);

const webhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT']).optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const slackConfigSchema = z.object({
  webhookUrl: z.string().url(),
  channel: z.string().optional(),
});

const pagerdutyConfigSchema = z.object({
  routingKey: z.string().min(1),
  severityMap: z.record(z.string(), z.string()).optional(),
});

const emailConfigSchema = z.object({
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional(),
  smtpPass: z.string().optional(),
  from: z.string().email(),
  to: z.array(z.string().email()).min(1),
});

export const createNotificationChannelSchema = z.object({
  type: notificationChannelTypeSchema,
  name: z.string().min(1).max(200),
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export const updateNotificationChannelSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export type CreateNotificationChannelInput = z.infer<typeof createNotificationChannelSchema>;
export type UpdateNotificationChannelInput = z.infer<typeof updateNotificationChannelSchema>;

/** Validate config matches the channel type */
export function validateChannelConfig(type: string, config: Record<string, unknown>): { valid: boolean; error?: string } {
  try {
    switch (type) {
      case 'webhook': webhookConfigSchema.parse(config); break;
      case 'slack': slackConfigSchema.parse(config); break;
      case 'pagerduty': pagerdutyConfigSchema.parse(config); break;
      case 'email': emailConfigSchema.parse(config); break;
      default: return { valid: false, error: `Unknown channel type: ${type}` };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
