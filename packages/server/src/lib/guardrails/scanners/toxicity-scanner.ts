/**
 * Toxicity Detection Scanner (Feature 8)
 *
 * Local, inline profanity/slur detection via the `obscenity` matcher (handles
 * leetspeak/obfuscation and returns match offsets). conditionConfig is the shared
 * ToxicityDetectionConfigSchema.
 *
 * ponytail: obscenity is a single profanity/slur dataset — it can't distinguish
 * the schema's four categories (toxic/threat/insult/profanity), so `categories`
 * acts as a coarse on/off gate rather than per-bucket routing. Swap in a
 * categorized source if fine-grained buckets ever matter. The `perspective_api`/
 * `openai_moderation` backends can't run in the inline path (the engine caps
 * async scanners at ~50ms and wires in no HTTP/LLM client), so they fall back to
 * the local matcher with a warning.
 */
import type { ContentMatch } from '@agentkitai/agentlens-core';
import { ToxicityDetectionConfigSchema } from '@agentkitai/agentlens-core';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { ContentScanner, type ScanContext, type ScanResult } from './base-scanner.js';
import { createLogger } from '../../logger.js';

const log = createLogger('ToxicityScanner');

// Built once (compile-once, like the pattern scanners).
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
// A dataset hit is high-signal; obscenity absorbs the obfuscation itself.
const MATCH_CONFIDENCE = 0.9;

export class ToxicityScanner extends ContentScanner {
  readonly type = 'toxicity_detection';
  private enabled = true;
  private threshold = 0.7;

  compile(conditionConfig: Record<string, unknown>): void {
    const config = ToxicityDetectionConfigSchema.parse(conditionConfig);
    this.threshold = config.threshold;
    this.enabled = config.categories.length > 0;
    if (config.backend !== 'local_wordlist') {
      log.warn(`toxicity backend '${config.backend}' can't run in the inline guardrail path; using the local matcher`);
    }
  }

  scan(content: string, _context: ScanContext): ScanResult {
    const matches: ContentMatch[] = [];
    if (!this.enabled || MATCH_CONFIDENCE < this.threshold) return { matches };
    for (const m of matcher.getAllMatches(content, true)) {
      const word = englishDataset.getPayloadWithPhraseMetadata(m).phraseMetadata?.originalWord;
      matches.push({
        conditionType: 'toxicity_detection',
        patternName: word ?? 'toxic',
        offset: { start: m.startIndex, end: m.endIndex + 1 }, // obscenity endIndex is inclusive
        confidence: MATCH_CONFIDENCE,
        redactionToken: '[TOXIC_REDACTED]',
      });
    }
    return { matches };
  }
}
