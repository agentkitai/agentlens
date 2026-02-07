/**
 * @agentlens/core — Zod Validation Schemas
 *
 * Runtime validation schemas for all API inputs per Architecture §4.2
 */
import { z } from 'zod';

/**
 * Schema for validating event types
 */
export const eventTypeSchema = z.enum([
  'session_started',
  'session_ended',
  'tool_call',
  'tool_response',
  'tool_error',
  'approval_requested',
  'approval_granted',
  'approval_denied',
  'approval_expired',
  'form_submitted',
  'form_completed',
  'form_expired',
  'cost_tracked',
  'alert_triggered',
  'alert_resolved',
  'custom',
]);

/**
 * Schema for validating severity levels
 */
export const severitySchema = z.enum(['debug', 'info', 'warn', 'error', 'critical']);

/**
 * Schema for validating inbound event ingestion
 */
export const ingestEventSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  agentId: z.string().min(1, 'agentId is required'),
  eventType: eventTypeSchema,
  severity: severitySchema.default('info'),
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).default({}),
  /** Optional client-side timestamp; server will validate and may override */
  timestamp: z.string().datetime().optional(),
});

/**
 * Type inferred from the ingest event schema
 */
export type IngestEventInput = z.infer<typeof ingestEventSchema>;
