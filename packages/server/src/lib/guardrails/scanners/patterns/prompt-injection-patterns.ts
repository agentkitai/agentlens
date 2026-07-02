/**
 * Prompt-injection heuristics, bucketed by the schema's `strategies`.
 *
 * Per-pattern `confidence` drives the scanner's sensitivity gate
 * (high→0.4 / medium→0.6 / low→0.8): higher sensitivity fires lower-confidence
 * patterns too. All regexes carry the `g` flag for the scanner's exec loop.
 *
 * ponytail: pattern-based detection catches the known phrasings, not novel/
 * paraphrased attacks — that's the ceiling of an inline heuristic. A model-backed
 * classifier would need out-of-band async wiring the engine doesn't have.
 */
import type { PatternDef } from './pii-patterns.js';

const T = '[PROMPT_INJECTION_REDACTED]';

// Zero-width / BOM chars used to smuggle instructions past the eye. Built via
// RegExp so the source stays pure ASCII (literal invisible chars are unsafe to
// keep in a source file).
const ZERO_WIDTH = new RegExp('[\\u200b-\\u200f\\u2060\\uFEFF]', 'g');

export const PROMPT_INJECTION_PATTERNS: Record<string, PatternDef[]> = {
  instruction_override: [
    { name: 'ignore-previous', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|context)/gi, redactionToken: T, confidence: 0.9 },
    { name: 'disregard-above', regex: /disregard\s+(the\s+)?(above|system|previous)/gi, redactionToken: T, confidence: 0.85 },
    { name: 'forget-prior', regex: /forget\s+(everything|all)\s+(you|prior|above|previous)/gi, redactionToken: T, confidence: 0.8 },
    { name: 'override-instructions', regex: /(new|updated|real)\s+instructions\s*:/gi, redactionToken: T, confidence: 0.6 },
  ],
  role_play: [
    { name: 'pretend-to-be', regex: /pretend\s+(to\s+be|you\s+are|that\s+you)/gi, redactionToken: T, confidence: 0.7 },
    { name: 'dan-jailbreak', regex: /\b(DAN|do\s+anything\s+now)\b/g, redactionToken: T, confidence: 0.7 },
    { name: 'developer-mode', regex: /developer\s+mode/gi, redactionToken: T, confidence: 0.6 },
    { name: 'you-are-now', regex: /you\s+are\s+now\s+(a|an|the)?/gi, redactionToken: T, confidence: 0.55 },
    { name: 'act-as', regex: /act\s+as\s+(if|a|an|though)/gi, redactionToken: T, confidence: 0.45 },
  ],
  delimiter_injection: [
    { name: 'chatml-tags', regex: /<\|im_(start|end)\|>/gi, redactionToken: T, confidence: 0.9 },
    { name: 'inst-tags', regex: /\[\/?(INST|SYS|SYSTEM)\]/g, redactionToken: T, confidence: 0.8 },
    { name: 'role-header', regex: /^\s*(system|assistant)\s*:/gim, redactionToken: T, confidence: 0.5 },
  ],
  encoding_attack: [
    { name: 'zero-width', regex: ZERO_WIDTH, redactionToken: T, confidence: 0.7 },
    { name: 'hex-escapes', regex: /(\\x[0-9a-f]{2}){6,}/gi, redactionToken: T, confidence: 0.6 },
    { name: 'long-base64', regex: /\b[A-Za-z0-9+/]{48,}={0,2}\b/g, redactionToken: T, confidence: 0.45 },
  ],
  context_manipulation: [
    { name: 'trusted-claim', regex: /the\s+(following|text\s+below)\s+is\s+(a\s+)?(safe|trusted|verified|authorized)/gi, redactionToken: T, confidence: 0.6 },
    { name: 'hypothetical', regex: /this\s+is\s+(just\s+)?(a\s+test|hypothetical|fiction|role[- ]?play)/gi, redactionToken: T, confidence: 0.45 },
  ],
};
