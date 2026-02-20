/**
 * Base Content Scanner (Feature 8 — Story 3)
 */
import type { ContentMatch } from '@agentlensai/core';

export interface ScanContext {
  tenantId: string;
  agentId: string;
  toolName: string;
  direction: 'input' | 'output';
}

export interface ScanResult {
  matches: ContentMatch[];
}

export abstract class ContentScanner {
  abstract readonly type: string;

  /** Initialize/compile patterns for the given rule config. Called once. */
  abstract compile(conditionConfig: Record<string, unknown>): void;

  /** Scan content and return matches. */
  abstract scan(content: string, context: ScanContext): ScanResult | Promise<ScanResult>;

  /** Whether this scanner requires async execution. */
  get isAsync(): boolean {
    return false;
  }
}
