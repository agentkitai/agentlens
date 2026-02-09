/**
 * Layer 6: Human Review Gate (Story 2.2)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';

/** Interface for the review queue store */
export interface ReviewQueueStore {
  addToQueue(entry: {
    id: string;
    tenantId: string;
    lessonId: string;
    originalTitle: string;
    originalContent: string;
    redactedTitle: string;
    redactedContent: string;
    redactionFindings: string;
    status: string;
    createdAt: string;
    expiresAt: string;
  }): void | Promise<void>;

  getReviewStatus(reviewId: string): Promise<{ status: string } | null> | { status: string } | null;
  approveReview(reviewId: string, reviewedBy: string): void | Promise<void>;
  rejectReview(reviewId: string, reviewedBy: string): void | Promise<void>;
}

export class HumanReviewLayer implements RedactionLayer {
  readonly name = 'human_review' as const;
  readonly order = 600;

  constructor(
    private readonly enabled: boolean = false,
    private readonly store?: ReviewQueueStore,
    private readonly generateId: () => string = () => crypto.randomUUID(),
  ) {}

  async process(input: string, _context: RedactionContext): Promise<RedactionLayerResult> {
    if (!this.enabled) {
      // Pass-through when disabled
      return { output: input, findings: [], blocked: false };
    }

    if (!this.store) {
      // If enabled but no store provided, block (fail-closed)
      return {
        output: input,
        findings: [],
        blocked: true,
        blockReason: 'Human review is enabled but no review queue store is configured',
      };
    }

    const reviewId = this.generateId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.store.addToQueue({
      id: reviewId,
      tenantId: _context.tenantId,
      lessonId: '', // filled by pipeline
      originalTitle: '',
      originalContent: '',
      redactedTitle: '',
      redactedContent: input,
      redactionFindings: '[]',
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });

    const finding: RedactionFinding = {
      layer: 'human_review',
      category: 'pending_review',
      originalLength: input.length,
      replacement: '',
      startOffset: 0,
      endOffset: input.length,
      confidence: 1.0,
    };

    return {
      output: input,
      findings: [finding],
      blocked: true,
      blockReason: `pending_review:${reviewId}`,
    };
  }
}
