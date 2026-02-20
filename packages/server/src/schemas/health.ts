/**
 * OpenAPI schemas for health endpoints.
 * [F13-S2]
 */
import { z } from '@hono/zod-openapi';

export const WindowQuerySchema = z.object({
  window: z.coerce.number().int()
    .min(1, 'window must be an integer between 1 and 90')
    .max(90, 'window must be an integer between 1 and 90')
    .default(7)
    .openapi({ example: 7, description: 'Lookback window in days (1-90)' }),
});

export const HealthDimensionSchema = z.object({
  name: z.string().openapi({ example: 'error_rate' }),
  score: z.number().openapi({ example: 0.95 }),
  weight: z.number().openapi({ example: 0.3 }),
  details: z.record(z.string(), z.unknown()).optional(),
}).openapi('HealthDimension');

export const HealthScoreSchema = z.object({
  agentId: z.string().openapi({ example: 'agent_01HXK' }),
  overallScore: z.number().openapi({ example: 0.87 }),
  dimensions: z.array(HealthDimensionSchema),
  sessionCount: z.number().int().openapi({ example: 42 }),
  window: z.number().int().openapi({ example: 7 }),
}).openapi('HealthScore');

export const HealthOverviewSchema = z.object({
  agents: z.array(HealthScoreSchema),
  computedAt: z.string().openapi({ example: '2026-02-20T10:00:00.000Z' }),
}).openapi('HealthOverview');

export const HealthSnapshotSchema = z.object({
  agentId: z.string(),
  date: z.string(),
  overallScore: z.number(),
  errorRateScore: z.number(),
  costEfficiencyScore: z.number(),
  toolSuccessScore: z.number(),
  latencyScore: z.number(),
  completionRateScore: z.number(),
  sessionCount: z.number().int(),
}).openapi('HealthSnapshot');

export const HealthHistoryResponseSchema = z.object({
  snapshots: z.array(HealthSnapshotSchema),
  agentId: z.string(),
  days: z.number().int(),
}).openapi('HealthHistoryResponse');

export const HealthHistoryQuerySchema = z.object({
  agentId: z.string().optional()
    .openapi({ description: 'Agent ID (required)', example: 'agent_01HXK' }),
  days: z.coerce.number().int().min(1).max(365).default(30)
    .openapi({ example: 30, description: 'Number of days of history (1-365)' }),
});

export const AgentIdParamSchema = z.object({
  id: z.string().openapi({ example: 'agent_01HXK', description: 'Agent identifier' }),
});
