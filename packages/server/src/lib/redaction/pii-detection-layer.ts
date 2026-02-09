/**
 * Layer 2: PII Detection (Story 2.1)
 */

import type {
  RedactionLayer,
  RedactionLayerResult,
  RedactionContext,
  RedactionFinding,
} from '@agentlensai/core';

export interface PIIPattern {
  name: string;
  category: string;
  regex: RegExp;
  replacement: string;
  confidence: number;
  validate?: (match: string) => boolean;
}

/**
 * Luhn algorithm for credit card validation.
 */
function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export const PII_PATTERNS: PIIPattern[] = [
  {
    name: 'email',
    category: 'email',
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL]',
    confidence: 0.95,
  },
  {
    name: 'ssn_dashed',
    category: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[SSN]',
    confidence: 0.95,
  },
  {
    name: 'ssn_plain',
    category: 'ssn',
    regex: /\b(?<!\d)(?!000|666|9\d\d)\d{3}(?!00)\d{2}(?!0000)\d{4}(?!\d)\b/g,
    replacement: '[SSN]',
    confidence: 0.70,
    validate: (match) => {
      const digits = match.replace(/\D/g, '');
      // Must be exactly 9 digits, not all same, not sequential
      return digits.length === 9 && !/^(\d)\1{8}$/.test(digits);
    },
  },
  {
    name: 'credit_card_16',
    category: 'credit_card',
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: '[CREDIT_CARD]',
    confidence: 0.90,
    validate: (match) => luhnCheck(match),
  },
  {
    name: 'credit_card_amex',
    category: 'credit_card',
    regex: /\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b/g,
    replacement: '[CREDIT_CARD]',
    confidence: 0.90,
    validate: (match) => luhnCheck(match),
  },
  {
    name: 'phone_us',
    category: 'phone',
    regex: /(?:\+?1[-.\s])?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    replacement: '[PHONE]',
    confidence: 0.85,
  },
  {
    name: 'phone_international',
    category: 'phone',
    regex: /\+\d{1,3}[-.\s]?\d{1,4}[-.\s]?\d{2,4}[-.\s]?\d{2,4}[-.\s]?\d{0,4}\b/g,
    replacement: '[PHONE]',
    confidence: 0.80,
  },
  {
    name: 'ip_address_v4',
    category: 'ip_address',
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replacement: '[IP_ADDRESS]',
    confidence: 0.80,
  },
  {
    name: 'ip_address_v6',
    category: 'ip_address',
    regex: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    replacement: '[IP_ADDRESS]',
    confidence: 0.80,
  },
  {
    name: 'ip_address_v6_compressed',
    category: 'ip_address',
    regex: /\b(?:[0-9a-fA-F]{1,4}:){1,6}(?::[0-9a-fA-F]{1,4}){1,6}\b/g,
    replacement: '[IP_ADDRESS]',
    confidence: 0.75,
  },
  {
    name: 'ip_address_v4_mapped_v6',
    category: 'ip_address',
    regex: /::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    replacement: '[IP_ADDRESS]',
    confidence: 0.80,
  },
];

/** Optional Presidio integration interface */
export interface PresidioProvider {
  analyze(text: string): Promise<Array<{
    entityType: string;
    start: number;
    end: number;
    score: number;
  }>>;
}

export class PIIDetectionLayer implements RedactionLayer {
  readonly name = 'pii_detection' as const;
  readonly order = 200;

  constructor(private readonly presidio?: PresidioProvider) {}

  async process(input: string, _context: RedactionContext): Promise<RedactionLayerResult> {
    const findings: RedactionFinding[] = [];
    const allMatches: Array<{
      start: number;
      end: number;
      replacement: string;
      category: string;
      confidence: number;
    }> = [];

    // Regex-based detection
    for (const pattern of PII_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;
      while ((match = regex.exec(input)) !== null) {
        if (pattern.validate && !pattern.validate(match[0])) continue;
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          replacement: pattern.replacement,
          category: pattern.category,
          confidence: pattern.confidence,
        });
      }
    }

    // Optional Presidio NER
    if (this.presidio) {
      const entities = await this.presidio.analyze(input);
      for (const entity of entities) {
        const alreadyCovered = allMatches.some(
          m => m.start <= entity.start && m.end >= entity.end,
        );
        if (!alreadyCovered) {
          allMatches.push({
            start: entity.start,
            end: entity.end,
            replacement: `[${entity.entityType}]`,
            category: entity.entityType.toLowerCase(),
            confidence: entity.score,
          });
        }
      }
    }

    // Sort descending by start for safe replacement
    allMatches.sort((a, b) => b.start - a.start);

    // Deduplicate overlapping
    const deduped: typeof allMatches = [];
    for (const m of allMatches) {
      if (!deduped.some(d => m.start < d.end && m.end > d.start)) {
        deduped.push(m);
      }
    }

    let output = input;
    // Record findings in ascending order
    const ascending = [...deduped].sort((a, b) => a.start - b.start);
    for (const m of ascending) {
      findings.push({
        layer: 'pii_detection',
        category: m.category,
        originalLength: m.end - m.start,
        replacement: m.replacement,
        startOffset: m.start,
        endOffset: m.end,
        confidence: m.confidence,
      });
    }

    // Apply replacements descending
    for (const m of deduped) {
      output = output.slice(0, m.start) + m.replacement + output.slice(m.end);
    }

    return { output, findings, blocked: false };
  }
}
