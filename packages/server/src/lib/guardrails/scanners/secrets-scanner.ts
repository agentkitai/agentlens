/**
 * Secrets Detection Scanner (Feature 8 — Story 5)
 */
import type { ContentMatch } from '@agentlensai/core';
import { SecretsDetectionConfigSchema } from '@agentlensai/core';
import { ContentScanner, type ScanContext, type ScanResult } from './base-scanner.js';
import { SECRET_PATTERNS } from './patterns/secret-patterns.js';
import type { PatternDef } from './patterns/pii-patterns.js';

export class SecretsScanner extends ContentScanner {
  readonly type = 'secrets_detection';
  private patterns: PatternDef[] = [];
  private customPatterns: PatternDef[] = [];

  compile(conditionConfig: Record<string, unknown>): void {
    const config = SecretsDetectionConfigSchema.parse(conditionConfig);

    this.patterns = config.patterns
      .filter((p) => SECRET_PATTERNS[p])
      .map((p) => SECRET_PATTERNS[p]);

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
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const matchText = match[0];
        if (pattern.validate && !pattern.validate(matchText)) continue;

        matches.push({
          conditionType: 'secrets_detection',
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
