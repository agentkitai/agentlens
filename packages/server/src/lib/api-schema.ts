/**
 * API Contract Schemas (Feature 9 — API Contract Governance)
 *
 * Zod schemas for key request/response types. These serve as the
 * canonical contract for SDK integration tests and API validation.
 */

import { z } from 'zod';

// ─── Sessions ────────────────────────────────────────

export const SessionResponseSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  status: z.enum(['active', 'completed', 'error', 'timeout']),
  startedAt: z.string().optional(),
  endedAt: z.string().optional().nullable(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionResponseSchema),
  total: z.number().int().nonnegative(),
  cursor: z.string().optional().nullable(),
});

// ─── Events ──────────────────────────────────────────

export const EventResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agentId: z.string(),
  eventType: z.string(),
  timestamp: z.string(),
  payload: z.record(z.string(), z.unknown()),
  severity: z.enum(['info', 'warn', 'error']).optional(),
});

export const EventListResponseSchema = z.object({
  events: z.array(EventResponseSchema),
  total: z.number().int().nonnegative().optional(),
  cursor: z.string().optional().nullable(),
});

// ─── Analytics ───────────────────────────────────────

export const AnalyticsBucketSchema = z.object({
  bucket: z.string(),
  count: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative().optional(),
  totalCost: z.number().nonnegative().optional(),
  avgDuration: z.number().nonnegative().optional(),
});

export const AnalyticsResponseSchema = z.object({
  buckets: z.array(AnalyticsBucketSchema),
  period: z.string().optional(),
});

// ─── Optimization ────────────────────────────────────

export const OptimizationSuggestionSchema = z.object({
  type: z.enum(['model_downgrade', 'prompt_optimization', 'tool_usage']),
  description: z.string(),
  estimatedSavings: z.number().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const OptimizationSuggestionsResponseSchema = z.object({
  agentId: z.string(),
  suggestions: z.array(OptimizationSuggestionSchema),
  analyzedSessions: z.number().int().nonnegative(),
  totalEstimatedSavings: z.number().nonnegative(),
});

// ─── API Version ─────────────────────────────────────

export const ApiVersionResponseSchema = z.object({
  current: z.string(),
  supported: z.array(z.string()),
});
