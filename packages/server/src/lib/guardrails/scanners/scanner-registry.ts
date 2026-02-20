/**
 * Scanner Registry (Feature 8 — Story 3)
 *
 * Maps condition types to scanner implementations with compile-once caching.
 */
import type { GuardrailRule } from '@agentlensai/core';
import type { ContentScanner } from './base-scanner.js';
import { PiiScanner } from './pii-scanner.js';
import { SecretsScanner } from './secrets-scanner.js';

/** Pre-compiled scanner cache: ruleId → scanner instance */
const scannerCache = new Map<string, ContentScanner>();

const CONTENT_CONDITION_TYPES = new Set([
  'pii_detection',
  'secrets_detection',
  'content_regex',
  'toxicity_detection',
  'prompt_injection',
]);

export function isContentRule(rule: GuardrailRule): boolean {
  return CONTENT_CONDITION_TYPES.has(rule.conditionType);
}

export function getScannerForRule(rule: GuardrailRule): ContentScanner {
  const cached = scannerCache.get(rule.id);
  if (cached) return cached;

  let scanner: ContentScanner;
  switch (rule.conditionType) {
    case 'pii_detection':
      scanner = new PiiScanner();
      break;
    case 'secrets_detection':
      scanner = new SecretsScanner();
      break;
    default:
      throw new Error(`No scanner for condition type: ${rule.conditionType}`);
  }

  scanner.compile(rule.conditionConfig);
  scannerCache.set(rule.id, scanner);
  return scanner;
}

export function invalidateScanner(ruleId: string): void {
  scannerCache.delete(ruleId);
}

export function invalidateAllScanners(): void {
  scannerCache.clear();
}

/** Exposed for testing */
export function _getCacheSize(): number {
  return scannerCache.size;
}
