/**
 * Discovery & Delegation Types (Phase 4 — Story 1.2)
 *
 * Types for agent capability registration, discovery queries,
 * and cross-agent task delegation.
 *
 * @see {@link CapabilityRegistration} for registering agent capabilities
 * @see {@link DelegationRequest} for delegating tasks to other agents
 */

// ─── Task Types ────────────────────────────────────────────

/**
 * All supported task types for capability registration and discovery.
 */
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

/**
 * A supported task type string.
 * Use `'custom'` with {@link CapabilityRegistration.customType} for unlisted task types.
 */
export type TaskType = typeof TASK_TYPES[number];

// ─── JSON Schema type alias ───────────────────────────────

/** JSON Schema object (simplified type for capability schemas) */
export type JsonSchema = Record<string, unknown>;

// ─── Capability Registration ──────────────────────────────

/**
 * Describes a capability an agent registers for discovery by other agents.
 *
 * @see {@link DiscoveryQuery} for querying registered capabilities
 */
export interface CapabilityRegistration {
  /** The type of task this capability handles */
  taskType: TaskType;
  /** Custom task type identifier when {@link taskType} is `'custom'` */
  customType?: string;
  /** JSON Schema describing the expected input format */
  inputSchema: JsonSchema;
  /** JSON Schema describing the output format */
  outputSchema: JsonSchema;
  /** MIME types this capability accepts as input */
  inputMimeTypes?: string[];
  /** MIME types this capability can produce as output */
  outputMimeTypes?: string[];
  /** Historical quality metrics for this capability */
  qualityMetrics: {
    /** Fraction of tasks completed successfully (0–1) */
    successRate?: number;
    /** Average execution latency in milliseconds */
    avgLatencyMs?: number;
    /** Average cost per task in USD */
    avgCostUsd?: number;
    /** Total number of tasks completed */
    completedTasks?: number;
  };
  /** Estimated latency for a single task in milliseconds */
  estimatedLatencyMs?: number;
  /** Estimated cost for a single task in USD */
  estimatedCostUsd?: number;
  /** Maximum input size in bytes */
  maxInputBytes?: number;
  /** Visibility scope: `'internal'` (same tenant) or `'public'` (community pool) */
  scope: 'internal' | 'public';
}

// ─── Discovery ────────────────────────────────────────────

/**
 * Query parameters for discovering agents with matching capabilities.
 *
 * @see {@link DiscoveryResult} for the returned results
 */
export interface DiscoveryQuery {
  /** The task type to search for */
  taskType: TaskType;
  /** Custom task type filter (used when {@link taskType} is `'custom'`) */
  customType?: string;
  /** Required input MIME type */
  inputMimeType?: string;
  /** Required output MIME type */
  outputMimeType?: string;
  /** Minimum trust score percentile (0–100) */
  minTrustScore?: number;
  /** Maximum acceptable cost per task in USD */
  maxCostUsd?: number;
  /** Maximum acceptable latency in milliseconds */
  maxLatencyMs?: number;
  /** Scope to search: `'internal'`, `'public'`, or `'all'` */
  scope: 'internal' | 'public' | 'all';
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * A single agent capability returned from a discovery query.
 * Agent identity is anonymized via {@link anonymousAgentId}.
 *
 * @see {@link DiscoveryQuery} for the query that produces these results
 */
export interface DiscoveryResult {
  /** Anonymized identifier for the agent (not the real agent ID) */
  anonymousAgentId: string;
  /** The task type this agent can handle */
  taskType: TaskType;
  /** Custom task type (when {@link taskType} is `'custom'`) */
  customType?: string;
  /** JSON Schema describing the expected input format */
  inputSchema: JsonSchema;
  /** JSON Schema describing the output format */
  outputSchema: JsonSchema;
  /** Trust score as a percentile (0–100) relative to other agents */
  trustScorePercentile: number;
  /** Whether the trust score is provisional (insufficient history) */
  provisional: boolean;
  /** Estimated latency for a single task in milliseconds */
  estimatedLatencyMs?: number;
  /** Estimated cost for a single task in USD */
  estimatedCostUsd?: number;
  /** Quality metrics for this agent's capability */
  qualityMetrics: {
    /** Fraction of tasks completed successfully (0–1) */
    successRate?: number;
    /** Total number of tasks completed */
    completedTasks?: number;
  };
}

// ─── Delegation ───────────────────────────────────────────

/**
 * Request to delegate a task to another agent found via discovery.
 *
 * @see {@link DelegationResult} for the response
 * @see {@link DiscoveryResult.anonymousAgentId} for obtaining the target ID
 */
export interface DelegationRequest {
  /** Unique identifier for this delegation request */
  requestId: string;
  /** Anonymized ID of the target agent (from {@link DiscoveryResult}) */
  targetAnonymousId: string;
  /** The task type to delegate */
  taskType: TaskType;
  /** Task input payload (must conform to the agent's input schema) */
  input: unknown;
  /** Maximum time to wait for completion in milliseconds */
  timeoutMs: number;
  /** Whether to automatically try another agent on failure */
  fallbackEnabled?: boolean;
  /** Maximum number of retry attempts */
  maxRetries?: number;
}

/**
 * Result returned after a delegation attempt completes.
 *
 * @see {@link DelegationRequest} for the originating request
 */
export interface DelegationResult {
  /** The request ID matching the original {@link DelegationRequest} */
  requestId: string;
  /** Outcome of the delegation attempt */
  status: 'success' | 'rejected' | 'timeout' | 'error';
  /** Task output (present when status is `'success'`) */
  output?: unknown;
  /** Actual execution time in milliseconds */
  executionTimeMs?: number;
  /** Actual cost incurred in USD */
  costIncurred?: number;
  /** Number of retry attempts used */
  retriesUsed?: number;
}

/**
 * Lifecycle phases a delegation passes through.
 */
export type DelegationPhase =
  | 'request'
  | 'accepted'
  | 'rejected'
  | 'executing'
  | 'completed'
  | 'timeout'
  | 'error';

/**
 * Array of all delegation phases for iteration/validation.
 */
export const DELEGATION_PHASES: readonly DelegationPhase[] = [
  'request',
  'accepted',
  'rejected',
  'executing',
  'completed',
  'timeout',
  'error',
] as const;
