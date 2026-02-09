/**
 * Layer 1: Secret Detection (Story 2.1)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';
import { ACTIVE_SECRET_PATTERNS, detectHighEntropyStrings } from './secret-patterns.js';

export class SecretDetectionLayer implements RedactionLayer {
  readonly name = 'secret_detection' as const;
  readonly order = 100;

  process(input: string, _context: RedactionContext): RedactionLayerResult {
    const findings: RedactionFinding[] = [];
    let output = input;
    let secretIndex = 0;

    // Collect all matches with their positions (work on original input for offsets)
    const allMatches: Array<{
      start: number;
      end: number;
      category: string;
      confidence: number;
      patternName: string;
    }> = [];

    // Regex-based detection
    for (const pattern of ACTIVE_SECRET_PATTERNS) {
      const globalRegex = new RegExp(pattern.regex.source, pattern.regex.flags + (pattern.regex.flags.includes('g') ? '' : 'g'));
      let match: RegExpExecArray | null;
      while ((match = globalRegex.exec(input)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          category: pattern.category,
          confidence: pattern.confidence,
          patternName: pattern.name,
        });
      }
    }

    // High-entropy detection
    const entropyMatches = detectHighEntropyStrings(input);
    for (const em of entropyMatches) {
      // Skip if already covered by a regex match
      const alreadyCovered = allMatches.some(
        m => m.start <= em.start && m.end >= em.end,
      );
      if (!alreadyCovered) {
        allMatches.push({
          start: em.start,
          end: em.end,
          category: 'high_entropy_string',
          confidence: Math.min(0.6 + (em.entropy - 4.5) * 0.1, 0.9),
          patternName: 'entropy_detection',
        });
      }
    }

    // Sort by start position descending to replace from end (preserves offsets)
    allMatches.sort((a, b) => b.start - a.start);

    // Deduplicate overlapping matches (keep highest confidence)
    const deduped: typeof allMatches = [];
    for (const m of allMatches) {
      const overlaps = deduped.some(
        d => m.start < d.end && m.end > d.start,
      );
      if (!overlaps) {
        deduped.push(m);
      }
    }

    // Sort ascending for findings reporting, but replace descending
    const sortedForFindings = [...deduped].sort((a, b) => a.start - b.start);
    const replacements = new Map<typeof allMatches[0], string>();

    for (const m of sortedForFindings) {
      secretIndex++;
      const replacement = `[SECRET_REDACTED_${secretIndex}]`;
      replacements.set(m, replacement);
      findings.push({
        layer: 'secret_detection',
        category: m.category,
        originalLength: m.end - m.start,
        replacement,
        startOffset: m.start,
        endOffset: m.end,
        confidence: m.confidence,
      });
    }

    // Apply replacements from end to start
    const descending = [...deduped].sort((a, b) => b.start - a.start);
    for (const m of descending) {
      const replacement = replacements.get(m)!;
      output = output.slice(0, m.start) + replacement + output.slice(m.end);
    }

    return { output, findings, blocked: false };
  }
}
