/**
 * OpenAPI schemas for session endpoints.
 * [F13-S3]
 */
import { z } from '@hono/zod-openapi';

export const SessionQuerySchema = z.object({
  agentId: z.string().optional()
    .openapi({ description: 'Filter by agent ID', example: 'agent_01HXK' }),
  status: z.string().optional()
    .openapi({ description: 'Filter by status (comma-separated: active,completed,error)', example: 'active' }),
  from: z.string().optional()
    .openapi({ description: 'Start date filter (ISO 8601)', example: '2026-01-01T00:00:00Z' }),
  to: z.string().optional()
    .openapi({ description: 'End date filter (ISO 8601)', example: '2026-12-31T23:59:59Z' }),
  tags: z.string().optional()
    .openapi({ description: 'Filter by tags (comma-separated)', example: 'production,critical' }),
  limit: z.coerce.number().int().default(50)
    .openapi({ description: 'Maximum results to return (clamped to 1-500)', example: 50 }),
  offset: z.coerce.number().int().default(0)
    .openapi({ description: 'Number of results to skip (clamped to ≥0)', example: 0 }),
  countOnly: z.string().optional()
    .openapi({ description: 'If "true", return only the count', example: 'false' }),
});

export const SessionSchema = z.object({
  id: z.string().openapi({ example: 'sess_abc123' }),
  agentId: z.string().openapi({ example: 'agent_01HXK' }),
  status: z.string().openapi({ example: 'completed' }),
  startedAt: z.string().openapi({ example: '2026-02-20T10:00:00.000Z' }),
  endedAt: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  eventCount: z.number().int().optional(),
  errorCount: z.number().int().optional(),
  totalCost: z.number().optional(),
  totalTokens: z.number().int().optional(),
  totalDurationMs: z.number().optional(),
}).passthrough().openapi('Session');

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionSchema),
  total: z.number().int(),
  hasMore: z.boolean(),
}).openapi('SessionListResponse');

export const SessionCountResponseSchema = z.object({
  count: z.number().int(),
}).openapi('SessionCountResponse');

export const SessionIdParamSchema = z.object({
  id: z.string().openapi({ example: 'sess_abc123', description: 'Session ID' }),
});

export const TimelineEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  timestamp: z.string(),
  sessionId: z.string(),
}).passthrough().openapi('TimelineEvent');

export const SessionTimelineResponseSchema = z.object({
  events: z.array(TimelineEventSchema),
  chainValid: z.boolean(),
}).openapi('SessionTimelineResponse');
