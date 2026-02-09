/**
 * Discovery & Delegation Types (Phase 4 — Story 1.2)
 */

// ─── Task Types ────────────────────────────────────────────

export const TASK_TYPES = [
  'translation',
  'summarization',
  'code-review',
  'data-extraction',
  'classification',
  'generation',
  'analysis',
  'transformation',
  'custom',
] as const;

export type TaskType = typeof TASK_TYPES[number];

// ─── JSON Schema type alias ───────────────────────────────

/** JSON Schema object (simplified type for capability schemas) */
export type JsonSchema = Record<string, unknown>;

// ─── Capability Registration ──────────────────────────────

export interface CapabilityRegistration {
  taskType: TaskType;
  customType?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  inputMimeTypes?: string[];
  outputMimeTypes?: string[];
  qualityMetrics: {
    successRate?: number;
    avgLatencyMs?: number;
    avgCostUsd?: number;
    completedTasks?: number;
  };
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  maxInputBytes?: number;
  scope: 'internal' | 'public';
}

// ─── Discovery ────────────────────────────────────────────

export interface DiscoveryQuery {
  taskType: TaskType;
  customType?: string;
  inputMimeType?: string;
  outputMimeType?: string;
  minTrustScore?: number;
  maxCostUsd?: number;
  maxLatencyMs?: number;
  scope: 'internal' | 'public' | 'all';
  limit?: number;
}

export interface DiscoveryResult {
  anonymousAgentId: string;
  taskType: TaskType;
  customType?: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  trustScorePercentile: number;
  provisional: boolean;
  estimatedLatencyMs?: number;
  estimatedCostUsd?: number;
  qualityMetrics: {
    successRate?: number;
    completedTasks?: number;
  };
}

// ─── Delegation ───────────────────────────────────────────

export interface DelegationRequest {
  requestId: string;
  targetAnonymousId: string;
  taskType: TaskType;
  input: unknown;
  timeoutMs: number;
  fallbackEnabled?: boolean;
  maxRetries?: number;
}

export interface DelegationResult {
  requestId: string;
  status: 'success' | 'rejected' | 'timeout' | 'error';
  output?: unknown;
  executionTimeMs?: number;
  costIncurred?: number;
  retriesUsed?: number;
}

export type DelegationPhase =
  | 'request'
  | 'accepted'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'timeout'
  | 'error';

export const DELEGATION_PHASES: readonly DelegationPhase[] = [
  'request',
  'accepted',
  'rejected',
  'executing',
  'completed',
  'timeout',
  'error',
] as const;
