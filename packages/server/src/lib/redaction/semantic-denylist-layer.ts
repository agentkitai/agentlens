/**
 * Layer 5: Semantic Deny List (Story 2.2)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';

export class SemanticDenyListLayer implements RedactionLayer {
  readonly name = 'semantic_denylist' as const;
  readonly order = 500;

  process(input: string, context: RedactionContext): RedactionLayerResult {
    const findings: RedactionFinding[] = [];

    for (const pattern of context.denyListPatterns) {
      let matched = false;
      let matchStart = -1;
      let matchEnd = -1;
      let matchedText = '';

      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        // Regex pattern: /pattern/flags
        const lastSlash = pattern.lastIndexOf('/');
        const regexBody = pattern.slice(1, lastSlash);
        const flags = pattern.slice(lastSlash + 1);
        try {
          const regex = new RegExp(regexBody, flags.includes('i') ? 'gi' : 'g');
          const match = regex.exec(input);
          if (match) {
            matched = true;
            matchStart = match.index;
            matchEnd = match.index + match[0].length;
            matchedText = match[0];
          }
        } catch {
          // Invalid regex — skip
        }
      } else {
        // Plain text match (case-insensitive)
        const idx = input.toLowerCase().indexOf(pattern.toLowerCase());
        if (idx !== -1) {
          matched = true;
          matchStart = idx;
          matchEnd = idx + pattern.length;
          matchedText = input.slice(idx, idx + pattern.length);
        }
      }

      if (matched) {
        findings.push({
          layer: 'semantic_denylist',
          category: 'denied_content',
          originalLength: matchedText.length,
          replacement: '',
          startOffset: matchStart,
          endOffset: matchEnd,
          confidence: 1.0,
        });

        return {
          output: input,
          findings,
          blocked: true,
          blockReason: `Content matched deny-list pattern: ${pattern}`,
        };
      }
    }

    return { output: input, findings, blocked: false };
  }
}
