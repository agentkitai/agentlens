/**
 * Secret Pattern Library (Feature 8 — Story 5)
 */
import type { PatternDef } from './pii-patterns.js';

export const SECRET_PATTERNS: Record<string, PatternDef> = {
  aws_access_key: {
    name: 'aws_access_key',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    redactionToken: '[AWS_KEY_REDACTED]',
    confidence: 0.99,
  },
  aws_secret_key: {
    name: 'aws_secret_key',
    regex: /\b[A-Za-z0-9/+=]{40}\b/g,
    redactionToken: '[AWS_SECRET_REDACTED]',
    confidence: 0.70,
  },
  github_token: {
    name: 'github_token',
    regex: /\bghp_[A-Za-z0-9]{36,}\b/g,
    redactionToken: '[GITHUB_TOKEN_REDACTED]',
    confidence: 0.99,
  },
  github_fine_grained: {
    name: 'github_fine_grained',
    regex: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g,
    redactionToken: '[GITHUB_TOKEN_REDACTED]',
    confidence: 0.99,
  },
  openai_key: {
    name: 'openai_key',
    regex: /\bsk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}\b/g,
    redactionToken: '[OPENAI_KEY_REDACTED]',
    confidence: 0.99,
  },
  anthropic_key: {
    name: 'anthropic_key',
    regex: /\bsk-ant-[A-Za-z0-9-]{80,}\b/g,
    redactionToken: '[ANTHROPIC_KEY_REDACTED]',
    confidence: 0.99,
  },
  stripe_key: {
    name: 'stripe_key',
    regex: /\b[rs]k_(test|live)_[A-Za-z0-9]{24,}\b/g,
    redactionToken: '[STRIPE_KEY_REDACTED]',
    confidence: 0.99,
  },
  generic_bearer: {
    name: 'generic_bearer',
    regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi,
    redactionToken: '[BEARER_TOKEN_REDACTED]',
    confidence: 0.90,
  },
  generic_api_key: {
    name: 'generic_api_key',
    regex: /\b(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9._~+/=-]{20,})['"]?\b/gi,
    redactionToken: '[API_KEY_REDACTED]',
    confidence: 0.80,
  },
  private_key_pem: {
    name: 'private_key_pem',
    regex: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    redactionToken: '[PRIVATE_KEY_REDACTED]',
    confidence: 0.99,
  },
  jwt: {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    redactionToken: '[JWT_REDACTED]',
    confidence: 0.95,
  },
};
