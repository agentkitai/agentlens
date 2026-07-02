/**
 * Prompt-Injection Scanner (Feature 8)
 *
 * Heuristic detection of prompt-injection / jailbreak attempts. conditionConfig is
 * the shared PromptInjectionConfigSchema: `strategies` selects which pattern
 * buckets to run, `sensitivity` gates by per-pattern confidence.
 */
import type { ContentMatch } from '@agentkitai/agentlens-core';
import { PromptInjectionConfigSchema } from '@agentkitai/agentlens-core';
import { ContentScanner, type ScanContext, type ScanResult } from './base-scanner.js';
import type { PatternDef } from './patterns/pii-patterns.js';
import { PROMPT_INJECTION_PATTERNS } from './patterns/prompt-injection-patterns.js';

const SENSITIVITY_MIN_CONFIDENCE = { low: 0.8, medium: 0.6, high: 0.4 } as const;

export class PromptInjectionScanner extends ContentScanner {
  readonly type = 'prompt_injection';
  private patterns: PatternDef[] = [];
  private minConfidence: number = SENSITIVITY_MIN_CONFIDENCE.medium;

  compile(conditionConfig: Record<string, unknown>): void {
    const config = PromptInjectionConfigSchema.parse(conditionConfig);
    this.minConfidence = SENSITIVITY_MIN_CONFIDENCE[config.sensitivity];
    this.patterns = config.strategies.flatMap((s) => PROMPT_INJECTION_PATTERNS[s] ?? []);
  }

  scan(content: string, _context: ScanContext): ScanResult {
    const matches: ContentMatch[] = [];
    for (const pattern of this.patterns) {
      if (pattern.confidence < this.minConfidence) continue;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        matches.push({
          conditionType: 'prompt_injection',
          patternName: pattern.name,
          offset: { start: match.index, end: match.index + match[0].length },
          confidence: pattern.confidence,
          redactionToken: pattern.redactionToken,
        });
        if (match[0].length === 0) regex.lastIndex++; // guard against zero-width infinite loop
      }
    }
    return { matches };
  }
}
