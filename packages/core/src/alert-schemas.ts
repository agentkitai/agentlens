/**
 * @agentlensai/core — Alert-specific Zod validation schemas
 *
 * Schemas for alert rule CRUD and alert history.
 */
import { z } from 'zod';

/**
 * Valid alert condition types
 */
export const alertConditionSchema = z.enum([
  'error_rate_exceeds',
  'cost_exceeds',
  'latency_exceeds',
  'event_count_exceeds',
  'no_events_for',
]);

/**
 * Schema for creating a new alert rule
 */
export const createAlertRuleSchema = z.object({
  name: z.string().min(1, 'Alert rule name is required').max(200),
  enabled: z.boolean().default(true),
  condition: alertConditionSchema,
  threshold: z.number().min(0, 'Threshold must be non-negative'),
  windowMinutes: z.number().int().min(1, 'Window must be at least 1 minute').max(43200), // max 30 days
  scope: z
    .object({
      agentId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .default({}),
  notifyChannels: z.array(z.string()).default([]),
});

export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;

/**
 * Schema for updating an existing alert rule (all fields optional)
 */
export const updateAlertRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  condition: alertConditionSchema.optional(),
  threshold: z.number().min(0).optional(),
  windowMinutes: z.number().int().min(1).max(43200).optional(),
  scope: z
    .object({
      agentId: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  notifyChannels: z.array(z.string()).optional(),
});

export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
