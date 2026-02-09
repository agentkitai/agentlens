/**
 * Redaction Pipeline Types (Phase 4 — Story 1.1)
 *
 * Branded types enforce compile-time separation between raw and redacted content.
 * RawLessonContent is NOT assignable to RedactedLessonContent.
 */

// ─── Branded Types ─────────────────────────────────────────

/** Branded type: raw lesson content that has NOT been redacted */
export interface RawLessonContent {
  readonly __brand: 'RawLessonContent';
  readonly title: string;
  readonly content: string;
  readonly context: Record<string, unknown>;
}

/** Branded type: lesson content that HAS passed all redaction layers */
export interface RedactedLessonContent {
  readonly __brand: 'RedactedLessonContent';
  readonly title: string;
  readonly content: string;
  readonly context: Record<string, unknown>;
}

// ─── Redaction Layer Names ─────────────────────────────────

export type RedactionLayerName =
  | 'secret_detection'
  | 'pii_detection'
  | 'url_path_scrubbing'
  | 'tenant_deidentification'
  | 'semantic_denylist'
  | 'human_review';

export const REDACTION_LAYER_NAMES: readonly RedactionLayerName[] = [
  'secret_detection',
  'pii_detection',
  'url_path_scrubbing',
  'tenant_deidentification',
  'semantic_denylist',
  'human_review',
] as const;

// ─── Redaction Finding ─────────────────────────────────────

/** A single finding from a redaction layer */
export interface RedactionFinding {
  layer: RedactionLayerName;
  category: string;
  originalLength: number;
  replacement: string;
  startOffset: number;
  endOffset: number;
  confidence: number;
}

// ─── Redaction Result ──────────────────────────────────────

/** Result of running the full pipeline */
export type RedactionResult =
  | { status: 'redacted'; content: RedactedLessonContent; findings: RedactionFinding[] }
  | { status: 'blocked'; reason: string; layer: RedactionLayerName }
  | { status: 'pending_review'; reviewId: string }
  | { status: 'error'; error: string; layer: RedactionLayerName };

// ─── Redaction Layer Interface ─────────────────────────────

/** Context provided to each redaction layer */
export interface RedactionContext {
  tenantId: string;
  agentId?: string;
  category: string;
  denyListPatterns: string[];
  knownTenantTerms: string[];
}

/** Result from a single redaction layer */
export interface RedactionLayerResult {
  output: string;
  findings: RedactionFinding[];
  blocked: boolean;
  blockReason?: string;
}

/** Plugin interface for custom redaction layers */
export interface RedactionLayer {
  readonly name: RedactionLayerName | string;
  readonly order: number;
  process(input: string, context: RedactionContext): RedactionLayerResult | Promise<RedactionLayerResult>;
}

// ─── Helper: Create branded types ──────────────────────────

/** Create a RawLessonContent from plain data */
export function createRawLessonContent(
  title: string,
  content: string,
  context: Record<string, unknown> = {},
): RawLessonContent {
  return { __brand: 'RawLessonContent' as const, title, content, context };
}

/**
 * Secret key required to create RedactedLessonContent.
 * Only the RedactionPipeline should use this.
 * @internal
 */
export const REDACTION_PIPELINE_KEY = Symbol.for('@@agentlens/redaction-pipeline-key');

/**
 * Create a RedactedLessonContent from plain data.
 * @internal — Only the RedactionPipeline should call this. Requires the pipeline key.
 * Calling without the key throws an error.
 */
export function createRedactedLessonContent(
  title: string,
  content: string,
  context: Record<string, unknown> = {},
  _pipelineKey?: symbol,
): RedactedLessonContent {
  if (_pipelineKey !== REDACTION_PIPELINE_KEY) {
    throw new Error('createRedactedLessonContent is internal to the RedactionPipeline. Do not call directly.');
  }
  return { __brand: 'RedactedLessonContent' as const, title, content, context };
}
