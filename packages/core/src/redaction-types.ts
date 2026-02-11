/**
 * Redaction Pipeline Types (Phase 4 — Story 1.1)
 *
 * Branded types enforce compile-time separation between raw and redacted content.
 * RawLessonContent is NOT assignable to RedactedLessonContent.
 *
 * @see {@link RedactionLayer} for implementing custom redaction layers
 * @see {@link RedactionResult} for pipeline output
 */

// ─── Branded Types ─────────────────────────────────────────

/**
 * Branded type: raw lesson content that has NOT been redacted.
 * Must pass through the redaction pipeline before sharing.
 *
 * @see {@link RedactedLessonContent} for the post-redaction counterpart
 * @see {@link createRawLessonContent} to construct instances
 */
export interface RawLessonContent {
  /** Brand discriminator — prevents assignment to {@link RedactedLessonContent} */
  readonly __brand: 'RawLessonContent';
  /** Lesson title (may contain PII) */
  readonly title: string;
  /** Lesson body content (may contain PII) */
  readonly content: string;
  /** Arbitrary metadata associated with the lesson */
  readonly context: Record<string, unknown>;
}

/**
 * Branded type: lesson content that HAS passed all redaction layers.
 * Safe for community sharing.
 *
 * @see {@link RawLessonContent} for the pre-redaction counterpart
 * @see {@link createRedactedLessonContent} to construct instances (internal only)
 */
export interface RedactedLessonContent {
  /** Brand discriminator — prevents assignment to {@link RawLessonContent} */
  readonly __brand: 'RedactedLessonContent';
  /** Lesson title (redacted) */
  readonly title: string;
  /** Lesson body content (redacted) */
  readonly content: string;
  /** Arbitrary metadata associated with the lesson (redacted) */
  readonly context: Record<string, unknown>;
}

// ─── Redaction Layer Names ─────────────────────────────────

/**
 * Identifier for a built-in redaction layer in the pipeline.
 * Layers execute in a defined order to progressively sanitize content.
 */
export type RedactionLayerName =
  | 'secret_detection'
  | 'pii_detection'
  | 'url_path_scrubbing'
  | 'tenant_deidentification'
  | 'semantic_denylist'
  | 'human_review';

/**
 * Array of all redaction layer names for iteration/validation.
 */
export const REDACTION_LAYER_NAMES: readonly RedactionLayerName[] = [
  'secret_detection',
  'pii_detection',
  'url_path_scrubbing',
  'tenant_deidentification',
  'semantic_denylist',
  'human_review',
] as const;

// ─── Redaction Finding ─────────────────────────────────────

/**
 * A single finding from a redaction layer, describing one piece
 * of sensitive content that was detected and replaced.
 */
export interface RedactionFinding {
  /** Which redaction layer produced this finding */
  layer: RedactionLayerName;
  /** Category of the finding (e.g. `'email'`, `'api_key'`, `'name'`) */
  category: string;
  /** Character length of the original sensitive text */
  originalLength: number;
  /** The replacement string that was substituted (e.g. `'[REDACTED]'`) */
  replacement: string;
  /** Start character offset in the original content (inclusive) */
  startOffset: number;
  /** End character offset in the original content (exclusive) */
  endOffset: number;
  /** Confidence score for this detection (0–1) */
  confidence: number;
}

// ─── Redaction Result ──────────────────────────────────────

/**
 * Discriminated union representing the outcome of running the full redaction pipeline.
 *
 * - `'redacted'` — content was successfully redacted and is safe to share
 * - `'blocked'` — a layer blocked the content entirely
 * - `'pending_review'` — content is awaiting human review
 * - `'error'` — a layer encountered an error during processing
 */
export type RedactionResult =
  | { status: 'redacted'; content: RedactedLessonContent; findings: RedactionFinding[] }
  | { status: 'blocked'; reason: string; layer: RedactionLayerName }
  | { status: 'pending_review'; reviewId: string }
  | { status: 'error'; error: string; layer: RedactionLayerName };

// ─── Redaction Layer Interface ─────────────────────────────

/**
 * Context provided to each redaction layer during processing.
 * Contains tenant-specific configuration for customizing redaction behavior.
 */
export interface RedactionContext {
  /** Tenant ID for tenant-specific redaction rules */
  tenantId: string;
  /** Agent ID that produced the content (optional) */
  agentId?: string;
  /** Lesson category for category-specific rules */
  category: string;
  /** Regex patterns to deny (from tenant configuration) */
  denyListPatterns: string[];
  /** Known tenant-specific terms to redact (company names, project names, etc.) */
  knownTenantTerms: string[];
}

/**
 * Result returned by a single redaction layer after processing content.
 *
 * @see {@link RedactionLayer.process}
 */
export interface RedactionLayerResult {
  /** The content after this layer's redactions have been applied */
  output: string;
  /** Findings produced by this layer */
  findings: RedactionFinding[];
  /** Whether this layer blocked the content from being shared */
  blocked: boolean;
  /** Reason for blocking (present when {@link blocked} is `true`) */
  blockReason?: string;
}

/**
 * Plugin interface for custom redaction layers.
 * Implement this to add new redaction logic to the pipeline.
 *
 * @see {@link RedactionLayerName} for built-in layer names
 * @see {@link RedactionContext} for the context passed to {@link process}
 */
export interface RedactionLayer {
  /** Unique name identifying this layer */
  readonly name: RedactionLayerName | string;
  /** Execution order (lower numbers run first) */
  readonly order: number;
  /**
   * Process content through this redaction layer.
   * @param input - The content string to redact
   * @param context - Tenant and category context for redaction rules
   * @returns The redacted output with findings, synchronously or asynchronously
   */
  process(input: string, context: RedactionContext): RedactionLayerResult | Promise<RedactionLayerResult>;
}

// ─── Helper: Create branded types ──────────────────────────

/**
 * Create a {@link RawLessonContent} from plain data.
 * @param title - Lesson title
 * @param content - Lesson body content
 * @param context - Optional metadata
 */
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
 * Create a {@link RedactedLessonContent} from plain data.
 * @internal — Only the RedactionPipeline should call this. Requires the pipeline key.
 * Calling without the key throws an error.
 * @param title - Lesson title (redacted)
 * @param content - Lesson body content (redacted)
 * @param context - Optional metadata (redacted)
 * @param _pipelineKey - Must be {@link REDACTION_PIPELINE_KEY}
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
