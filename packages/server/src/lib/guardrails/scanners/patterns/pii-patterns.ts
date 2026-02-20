/**
 * PII Pattern Library (Feature 8 — Story 4)
 */

export interface PatternDef {
  name: string;
  regex: RegExp;
  redactionToken: string;
  confidence: number;
  validate?: (match: string) => boolean;
}

export function luhnCheck(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export const PII_PATTERNS: Record<string, PatternDef> = {
  ssn: {
    name: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    redactionToken: '[SSN_REDACTED]',
    confidence: 0.95,
  },
  credit_card: {
    name: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    redactionToken: '[CC_REDACTED]',
    confidence: 0.85,
    validate: luhnCheck,
  },
  email: {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    redactionToken: '[EMAIL_REDACTED]',
    confidence: 0.95,
  },
  phone_us: {
    name: 'phone_us',
    regex: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    redactionToken: '[PHONE_REDACTED]',
    confidence: 0.80,
  },
};
