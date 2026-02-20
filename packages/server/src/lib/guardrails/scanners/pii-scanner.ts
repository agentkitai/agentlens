/**
 * PII Detection Scanner (Feature 8 — Story 4)
 */
import type { ContentMatch } from '@agentlensai/core';
import { PiiDetectionConfigSchema } from '@agentlensai/core';
import { ContentScanner, type ScanContext, type ScanResult } from './base-scanner.js';
import { PII_PATTERNS, type PatternDef } from './patterns/pii-patterns.js';

export class PiiScanner extends ContentScanner {
  readonly type = 'pii_detection';
  private patterns: PatternDef[] = [];
  private customPatterns: PatternDef[] = [];
  private minConfidence = 0.8;

  compile(conditionConfig: Record<string, unknown>): void {
    const config = PiiDetectionConfigSchema.parse(conditionConfig);
    this.minConfidence = config.minConfidence;

    // Select built-in patterns
    this.patterns = config.patterns
      .filter((p) => PII_PATTERNS[p])
      .map((p) => PII_PATTERNS[p]);

    // Compile custom patterns
    this.customPatterns = [];
    if (config.customPatterns) {
      for (const [name, regexStr] of Object.entries(config.customPatterns)) {
        this.customPatterns.push({
          name,
          regex: new RegExp(regexStr, 'g'),
          redactionToken: `[${name.toUpperCase()}_REDACTED]`,
          confidence: 0.80,
        });
      }
    }
  }

  scan(content: string, _context: ScanContext): ScanResult {
    const matches: ContentMatch[] = [];
    const allPatterns = [...this.patterns, ...this.customPatterns];

    for (const pattern of allPatterns) {
      // Reset regex lastIndex for each scan
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const matchText = match[0];

        // Run optional validator (e.g., Luhn check for credit cards)
        if (pattern.validate && !pattern.validate(matchText)) {
          continue;
        }

        if (pattern.confidence < this.minConfidence) {
          continue;
        }

        matches.push({
          conditionType: 'pii_detection',
          patternName: pattern.name,
          offset: { start: match.index, end: match.index + matchText.length },
          confidence: pattern.confidence,
          redactionToken: pattern.redactionToken,
        });
      }
    }

    return { matches };
  }
}
