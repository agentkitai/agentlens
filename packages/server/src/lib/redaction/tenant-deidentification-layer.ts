/**
 * Layer 4: Tenant De-identification (Story 2.2)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';

// UUID v4 pattern
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

export class TenantDeidentificationLayer implements RedactionLayer {
  readonly name = 'tenant_deidentification' as const;
  readonly order = 400;

  process(input: string, context: RedactionContext): RedactionLayerResult {
    const findings: RedactionFinding[] = [];
    let output = input;

    // Build list of terms to strip
    const terms: string[] = [];
    if (context.tenantId) terms.push(context.tenantId);
    if (context.agentId) terms.push(context.agentId);
    terms.push(...context.knownTenantTerms);

    // Filter empty/very short terms (avoid stripping single chars)
    const validTerms = terms.filter(t => t.length >= 3);

    // Sort by length descending to replace longer terms first
    validTerms.sort((a, b) => b.length - a.length);

    for (const term of validTerms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'gi');
      let match: RegExpExecArray | null;
      while ((match = regex.exec(output)) !== null) {
        findings.push({
          layer: 'tenant_deidentification',
          category: 'tenant_term',
          originalLength: match[0].length,
          replacement: '[TENANT_ENTITY]',
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          confidence: 0.90,
        });
      }
      output = output.replace(regex, '[TENANT_ENTITY]');
    }

    // Strip UUIDs (could be tenant/agent/user IDs)
    const uuidRegex = new RegExp(UUID_RE.source, 'gi');
    let uuidMatch: RegExpExecArray | null;
    const uuidMatches: Array<{ start: number; end: number }> = [];
    while ((uuidMatch = uuidRegex.exec(output)) !== null) {
      uuidMatches.push({ start: uuidMatch.index, end: uuidMatch.index + uuidMatch[0].length });
    }

    // Replace UUIDs from end
    for (let i = uuidMatches.length - 1; i >= 0; i--) {
      const m = uuidMatches[i];
      findings.push({
        layer: 'tenant_deidentification',
        category: 'uuid',
        originalLength: m.end - m.start,
        replacement: '[TENANT_ENTITY]',
        startOffset: m.start,
        endOffset: m.end,
        confidence: 0.85,
      });
      output = output.slice(0, m.start) + '[TENANT_ENTITY]' + output.slice(m.end);
    }

    return { output, findings, blocked: false };
  }
}
