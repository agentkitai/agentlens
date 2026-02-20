/**
 * Scanner Registry (Feature 8 — Story 3)
 *
 * Maps condition types to scanner implementations with compile-once caching.
 */
import type { GuardrailRule } from '@agentlensai/core';
import type { ContentScanner } from './base-scanner.js';
import { PiiScanner } from './pii-scanner.js';
import { SecretsScanner } from './secrets-scanner.js';
import { createLogger } from '../../logger.js';

const log = createLogger('ScannerRegistry');

const UNIMPLEMENTED_TYPES = new Set(['content_regex', 'toxicity_detection', 'prompt_injection']);

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

export function getScannerForRule(rule: GuardrailRule): ContentScanner | null {
  if (UNIMPLEMENTED_TYPES.has(rule.conditionType)) {
    log.warn(`Scanner not implemented for condition type: ${rule.conditionType} (rule ${rule.id}), skipping`);
    return null;
  }

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
