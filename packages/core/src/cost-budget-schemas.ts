/**
 * Cost Budget Zod Schemas (Feature 5 — Story 1)
 *
 * Validation schemas for cost budget CRUD and anomaly config.
 */

import { z } from 'zod';

export const createCostBudgetSchema = z.object({
  scope: z.enum(['session', 'agent']),
  agentId: z.string().optional(),
  period: z.enum(['session', 'daily', 'weekly', 'monthly']),
  limitUsd: z.number().positive(),
  onBreach: z.enum(['alert', 'pause_agent', 'downgrade_model']).default('alert'),
  downgradeTargetModel: z.string().optional(),
  enabled: z.boolean().default(true),
}).refine(
  (d) => d.scope !== 'agent' || !!d.agentId,
  { message: 'agentId is required when scope is "agent"', path: ['agentId'] },
).refine(
  (d) => d.scope !== 'session' || d.period === 'session',
  { message: 'session scope only supports period "session"', path: ['period'] },
).refine(
  (d) => d.onBreach !== 'downgrade_model' || !!d.downgradeTargetModel,
  { message: 'downgradeTargetModel required when onBreach is "downgrade_model"', path: ['downgradeTargetModel'] },
);

export const updateCostBudgetSchema = z.object({
  scope: z.enum(['session', 'agent']).optional(),
  agentId: z.string().optional(),
  period: z.enum(['session', 'daily', 'weekly', 'monthly']).optional(),
  limitUsd: z.number().positive().optional(),
  onBreach: z.enum(['alert', 'pause_agent', 'downgrade_model']).optional(),
  downgradeTargetModel: z.string().optional(),
  enabled: z.boolean().optional(),
});

export const updateAnomalyConfigSchema = z.object({
  multiplier: z.number().min(1.5).max(20).optional(),
  minSessions: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export type CreateCostBudgetInput = z.infer<typeof createCostBudgetSchema>;
export type UpdateCostBudgetInput = z.infer<typeof updateCostBudgetSchema>;
export type UpdateAnomalyConfigInput = z.infer<typeof updateAnomalyConfigSchema>;
