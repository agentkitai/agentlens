/**
 * Redaction Pipeline Orchestrator (Story 2.3)
 */

import type {
  RedactionLayer,
  RedactionLayerName,
  RedactionContext,
  RedactionResult,
  RedactionFinding,
  RawLessonContent,
} from '@agentlensai/core';
import { createRedactedLessonContent, REDACTION_PIPELINE_KEY } from '@agentlensai/core';
import { SecretDetectionLayer } from './secret-detection-layer.js';
import { PIIDetectionLayer, type PresidioProvider } from './pii-detection-layer.js';
import { UrlPathScrubbingLayer } from './url-path-scrubbing-layer.js';
import { TenantDeidentificationLayer } from './tenant-deidentification-layer.js';
import { SemanticDenyListLayer } from './semantic-denylist-layer.js';
import { HumanReviewLayer, type ReviewQueueStore } from './human-review-layer.js';

export interface RedactionPipelineConfig {
  humanReviewEnabled?: boolean;
  reviewQueueStore?: ReviewQueueStore;
  presidioProvider?: PresidioProvider;
  publicDomainAllowlist?: string[];
}

export class RedactionPipeline {
  private layers: RedactionLayer[];

  constructor(
    config: RedactionPipelineConfig = {},
    customLayers?: RedactionLayer[],
  ) {
    const defaultLayers: RedactionLayer[] = [
      new SecretDetectionLayer(),
      new PIIDetectionLayer(config.presidioProvider),
      new UrlPathScrubbingLayer(config.publicDomainAllowlist),
      new TenantDeidentificationLayer(),
      new SemanticDenyListLayer(),
      new HumanReviewLayer(
        config.humanReviewEnabled ?? false,
        config.reviewQueueStore,
      ),
    ];

    if (customLayers) {
      defaultLayers.push(...customLayers);
    }

    this.layers = defaultLayers.sort((a, b) => a.order - b.order);
  }

  getLayers(): readonly RedactionLayer[] {
    return this.layers;
  }

  /**
   * Register a custom redaction layer at runtime.
   * The layer is inserted at the correct position based on its `order` field.
   * Multiple custom layers are supported.
   * Plugin errors trigger fail-closed behavior (same as built-in layers).
   */
  registerCustomLayer(layer: RedactionLayer): void {
    this.layers.push(layer);
    this.layers.sort((a, b) => a.order - b.order);
  }

  async process(raw: RawLessonContent, ctx: RedactionContext): Promise<RedactionResult> {
    // Combine title and content for processing
    let text = `${raw.title}\n---\n${raw.content}`;
    const allFindings: RedactionFinding[] = [];

    for (const layer of this.layers) {
      let result;
      try {
        result = await layer.process(text, ctx);
      } catch (error) {
        // FAIL-CLOSED: any layer error blocks the lesson
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
          layer: layer.name as RedactionLayerName,
        };
      }

      if (result.blocked) {
        // Check for pending_review special case
        if (result.blockReason?.startsWith('pending_review:')) {
          const reviewId = result.blockReason.split(':')[1];
          return { status: 'pending_review', reviewId };
        }

        return {
          status: 'blocked',
          reason: result.blockReason ?? 'Blocked by redaction layer',
          layer: layer.name as RedactionLayerName,
        };
      }

      text = result.output;
      allFindings.push(...result.findings);
    }

    // Split back into title and content
    const separatorIndex = text.indexOf('\n---\n');
    let title: string;
    let content: string;

    if (separatorIndex !== -1) {
      title = text.slice(0, separatorIndex);
      content = text.slice(separatorIndex + 5);
    } else {
      title = text;
      content = '';
    }

    return {
      status: 'redacted',
      content: createRedactedLessonContent(title, content, {}, REDACTION_PIPELINE_KEY), // context always stripped
      findings: allFindings,
    };
  }
}
