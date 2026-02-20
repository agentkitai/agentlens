/**
 * Diagnostic Response Parser (Story 18.5)
 *
 * Zod-based validation of LLM JSON output.
 */

import { z } from 'zod';

const EvidenceSchema = z.object({
  type: z.enum(['error_pattern', 'tool_sequence', 'metric', 'trend', 'event']),
  summary: z.string(),
});

const RootCauseSchema = z.object({
  description: z.string(),
  confidence: z.number().min(0).max(1),
  category: z.enum([
    'error_pattern',
    'tool_failure',
    'cost_anomaly',
    'performance_degradation',
    'configuration',
    'external',
  ]),
  evidence: z.array(EvidenceSchema),
});

const RecommendationSchema = z.object({
  action: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
  rationale: z.string(),
});

export const LLMDiagnosticResponseSchema = z.object({
  severity: z.enum(['critical', 'warning', 'info', 'healthy']),
  summary: z.string().max(500),
  rootCauses: z.array(RootCauseSchema).max(10),
  recommendations: z.array(RecommendationSchema).max(10),
});

export type LLMDiagnosticResponse = z.infer<typeof LLMDiagnosticResponseSchema>;

export interface ParseResult {
  success: true;
  data: LLMDiagnosticResponse;
}

export interface ParseError {
  success: false;
  error: string;
}

/**
 * Parse and validate LLM response against the diagnostic schema.
 */
export function parseLLMResponse(raw: string): ParseResult | ParseError {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { success: false, error: `Invalid JSON: ${raw.slice(0, 200)}` };
  }

  const result = LLMDiagnosticResponseSchema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      error: `Schema validation failed: ${result.error.issues.map((i) => i.message).join('; ')}`,
    };
  }

  return { success: true, data: result.data };
}
