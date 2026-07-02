/**
 * Content Regex Scanner (Feature 8)
 *
 * Flags/redacts content matching an admin-supplied regex. conditionConfig:
 *   { pattern: string, flags?: string, redactionToken?: string }
 *
 * ponytail: the pattern is admin-configured and runs synchronously in the request
 * path, so a pathological regex could ReDoS. Content is already capped at
 * MAX_CONTENT_SIZE upstream; if untrusted patterns ever become possible, move to a
 * timeout-bounded engine (re2/worker).
 */
import type { ContentMatch } from '@agentkitai/agentlens-core';
import { ContentScanner, type ScanContext, type ScanResult } from './base-scanner.js';
import { createLogger } from '../../logger.js';

const log = createLogger('RegexScanner');
const MAX_MATCHES = 1000;

export class RegexScanner extends ContentScanner {
  readonly type = 'content_regex';
  private regex: RegExp | null = null;
  private redactionToken = '[REDACTED]';

  compile(conditionConfig: Record<string, unknown>): void {
    const pattern = typeof conditionConfig.pattern === 'string' ? conditionConfig.pattern : '';
    const flags = typeof conditionConfig.flags === 'string' ? conditionConfig.flags : '';
    if (typeof conditionConfig.redactionToken === 'string') this.redactionToken = conditionConfig.redactionToken;
    if (!pattern) { this.regex = null; return; }
    // Always global so scan() finds every match; de-dupe requested flags.
    const safeFlags = [...new Set(('g' + flags).split(''))].join('');
    try {
      this.regex = new RegExp(pattern, safeFlags);
    } catch (e) {
      log.warn(`invalid content_regex pattern "${pattern}": ${(e as Error).message}`);
      this.regex = null;
    }
  }

  scan(content: string, _context: ScanContext): ScanResult {
    const matches: ContentMatch[] = [];
    if (!this.regex) return { matches };
    const regex = new RegExp(this.regex.source, this.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null && matches.length < MAX_MATCHES) {
      matches.push({
        conditionType: 'content_regex',
        patternName: 'content_regex',
        offset: { start: m.index, end: m.index + m[0].length },
        confidence: 1,
        redactionToken: this.redactionToken,
      });
      if (m[0].length === 0) regex.lastIndex++; // guard against zero-width infinite loop
    }
    return { matches };
  }
}
