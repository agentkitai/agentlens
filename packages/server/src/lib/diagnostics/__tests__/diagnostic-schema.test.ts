/**
 * Guards the diagnostic Structured-Outputs schema against the two bugs that made
 * "Diagnose with AI" silently fall back with OpenAI:
 *  1. schema not strict-compatible (missing additionalProperties:false, or using
 *     keywords OpenAI strict mode rejects) → API 400.
 *  2. evidence.type left unconstrained in the schema but enum-checked in the parser
 *     → the model invents types and every real diagnosis is rejected.
 */
import { describe, it, expect } from 'vitest';
import { DIAGNOSTIC_JSON_SCHEMA } from '../prompt-templates.js';
import { parseLLMResponse } from '../response-parser.js';

// Keywords OpenAI strict Structured Outputs does not support.
const FORBIDDEN = ['maxLength', 'minLength', 'pattern', 'format', 'maxItems', 'minItems', 'minimum', 'maximum', 'multipleOf'];

function walk(node: unknown, path: string, visit: (obj: Record<string, unknown>, path: string) => void) {
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (o.type === 'object') visit(o, path);
  for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`, visit);
}

describe('DIAGNOSTIC_JSON_SCHEMA (OpenAI strict Structured Outputs)', () => {
  it('sets additionalProperties:false on every object', () => {
    walk(DIAGNOSTIC_JSON_SCHEMA, '$', (obj, path) => {
      expect(obj.additionalProperties, `${path} missing additionalProperties:false`).toBe(false);
    });
  });

  it('uses no strict-mode-unsupported keywords', () => {
    const found: string[] = [];
    walk(DIAGNOSTIC_JSON_SCHEMA, '$', (obj, path) => {
      for (const k of FORBIDDEN) if (k in obj) found.push(`${path}.${k}`);
    });
    expect(found).toEqual([]);
  });

  it('constrains evidence.type to the values the parser accepts', () => {
    // A response whose evidence types come from the schema enum must parse.
    const schemaEvidenceEnum = (DIAGNOSTIC_JSON_SCHEMA as any).properties.rootCauses.items.properties.evidence.items.properties.type.enum as string[];
    expect(Array.isArray(schemaEvidenceEnum)).toBe(true);
    const sample = {
      severity: 'critical',
      summary: 'x',
      rootCauses: [{
        description: 'd', confidence: 0.9, category: 'tool_failure',
        evidence: schemaEvidenceEnum.map((t) => ({ type: t, summary: 's' })),
      }],
      recommendations: [{ action: 'a', priority: 'high', rationale: 'r' }],
    };
    const parsed = parseLLMResponse(JSON.stringify(sample));
    expect(parsed.success, parsed.success ? '' : parsed.error).toBe(true);
  });
});
