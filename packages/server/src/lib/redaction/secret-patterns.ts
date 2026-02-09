/**
 * Secret Detection Patterns & Entropy Calculator (Story 2.1, Layer 1)
 */

export interface SecretPattern {
  name: string;
  category: string;
  regex: RegExp;
  confidence: number;
}

export const SECRET_PATTERNS: SecretPattern[] = [
  // ─── OpenAI ─────────────────────────────────────────
  { name: 'openai_api_key', category: 'api_key', regex: /sk-[a-zA-Z0-9]{20,}/, confidence: 0.95 },
  { name: 'openai_org', category: 'api_key', regex: /org-[a-zA-Z0-9]{20,}/, confidence: 0.85 },

  // ─── Anthropic ──────────────────────────────────────
  { name: 'anthropic_api_key', category: 'api_key', regex: /sk-ant-[a-zA-Z0-9\-]{20,}/, confidence: 0.95 },

  // ─── GitHub ─────────────────────────────────────────
  { name: 'github_pat', category: 'api_key', regex: /ghp_[a-zA-Z0-9]{36}/, confidence: 0.95 },
  { name: 'github_oauth', category: 'api_key', regex: /gho_[a-zA-Z0-9]{36}/, confidence: 0.95 },
  { name: 'github_app_token', category: 'api_key', regex: /(?:ghu|ghs|ghr)_[a-zA-Z0-9]{36}/, confidence: 0.95 },

  // ─── AWS ────────────────────────────────────────────
  { name: 'aws_access_key', category: 'api_key', regex: /AKIA[0-9A-Z]{16}/, confidence: 0.95 },
  { name: 'aws_secret_key', category: 'api_key', regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*[A-Za-z0-9/+=]{40}/, confidence: 0.95 },

  // ─── Stripe ─────────────────────────────────────────
  { name: 'stripe_live_key', category: 'api_key', regex: /sk_live_[a-zA-Z0-9]{20,}/, confidence: 0.95 },
  { name: 'stripe_test_key', category: 'api_key', regex: /sk_test_[a-zA-Z0-9]{20,}/, confidence: 0.90 },
  { name: 'stripe_publishable', category: 'api_key', regex: /pk_(?:live|test)_[a-zA-Z0-9]{20,}/, confidence: 0.90 },
  { name: 'stripe_restricted', category: 'api_key', regex: /rk_(?:live|test)_[a-zA-Z0-9]{20,}/, confidence: 0.90 },

  // ─── Slack ──────────────────────────────────────────
  { name: 'slack_token', category: 'api_key', regex: /xox[bpras]-[a-zA-Z0-9\-]+/, confidence: 0.95 },
  { name: 'slack_webhook', category: 'api_key', regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/, confidence: 0.95 },

  // ─── Google ─────────────────────────────────────────
  { name: 'google_api_key', category: 'api_key', regex: /AIza[0-9A-Za-z\-_]{35}/, confidence: 0.90 },
  { name: 'google_oauth_client', category: 'api_key', regex: /[0-9]+-[a-z0-9_]{32}\.apps\.googleusercontent\.com/, confidence: 0.90 },

  // ─── Azure ──────────────────────────────────────────
  { name: 'azure_subscription', category: 'api_key', regex: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/, confidence: 0.3 },

  // ─── Twilio ─────────────────────────────────────────
  { name: 'twilio_api_key', category: 'api_key', regex: /SK[a-f0-9]{32}/, confidence: 0.85 },
  { name: 'twilio_account_sid', category: 'api_key', regex: /AC[a-f0-9]{32}/, confidence: 0.85 },

  // ─── SendGrid ───────────────────────────────────────
  { name: 'sendgrid_api_key', category: 'api_key', regex: /SG\.[a-zA-Z0-9_\-]{22}\.[a-zA-Z0-9_\-]{43}/, confidence: 0.95 },

  // ─── Mailgun ────────────────────────────────────────
  { name: 'mailgun_api_key', category: 'api_key', regex: /key-[a-zA-Z0-9]{32}/, confidence: 0.85 },

  // ─── Heroku ─────────────────────────────────────────
  { name: 'heroku_api_key', category: 'api_key', regex: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/, confidence: 0.3 },

  // ─── npm ────────────────────────────────────────────
  { name: 'npm_token', category: 'api_key', regex: /npm_[a-zA-Z0-9]{36}/, confidence: 0.95 },

  // ─── PyPI ───────────────────────────────────────────
  { name: 'pypi_token', category: 'api_key', regex: /pypi-[a-zA-Z0-9\-_]{50,}/, confidence: 0.95 },

  // ─── Discord ────────────────────────────────────────
  { name: 'discord_token', category: 'api_key', regex: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/, confidence: 0.90 },
  { name: 'discord_webhook', category: 'api_key', regex: /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/, confidence: 0.95 },

  // ─── Telegram ───────────────────────────────────────
  { name: 'telegram_bot_token', category: 'api_key', regex: /\d{8,10}:[A-Za-z0-9_-]{35}/, confidence: 0.85 },

  // ─── Bearer / Basic Auth ────────────────────────────
  { name: 'bearer_token', category: 'auth_token', regex: /Bearer\s+[a-zA-Z0-9._~+\/=-]{20,}/, confidence: 0.90 },
  { name: 'basic_auth', category: 'auth_token', regex: /Basic\s+[a-zA-Z0-9+\/=]{10,}/, confidence: 0.90 },

  // ─── URL with credentials ──────────────────────────
  { name: 'url_password', category: 'auth_token', regex: /\/\/[^:\/\s]+:[^@\/\s]+@[^\/\s]+/, confidence: 0.95 },

  // ─── Private Keys ──────────────────────────────────
  { name: 'private_key', category: 'private_key', regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----/, confidence: 0.99 },

  // ─── Connection Strings ─────────────────────────────
  { name: 'connection_string', category: 'connection_string', regex: /(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqp|mssql):\/\/[^\s]+/, confidence: 0.90 },

  // ─── JWT ────────────────────────────────────────────
  { name: 'jwt', category: 'auth_token', regex: /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/, confidence: 0.85 },

  // ─── HashiCorp Vault ────────────────────────────────
  { name: 'vault_token', category: 'api_key', regex: /hvs\.[a-zA-Z0-9_-]{24,}/, confidence: 0.90 },

  // ─── Datadog ────────────────────────────────────────
  { name: 'datadog_api_key', category: 'api_key', regex: /dd[a-f0-9]{40}/, confidence: 0.80 },

  // ─── Supabase ───────────────────────────────────────
  { name: 'supabase_key', category: 'api_key', regex: /sbp_[a-f0-9]{40}/, confidence: 0.90 },

  // ─── Vercel ─────────────────────────────────────────
  { name: 'vercel_token', category: 'api_key', regex: /vercel_[a-zA-Z0-9]{24,}/, confidence: 0.90 },

  // ─── Linear ─────────────────────────────────────────
  { name: 'linear_api_key', category: 'api_key', regex: /lin_api_[a-zA-Z0-9]{40,}/, confidence: 0.90 },

  // ─── Shopify ────────────────────────────────────────
  { name: 'shopify_token', category: 'api_key', regex: /shpat_[a-fA-F0-9]{32}/, confidence: 0.90 },
  { name: 'shopify_secret', category: 'api_key', regex: /shpss_[a-fA-F0-9]{32}/, confidence: 0.90 },

  // ─── Cloudflare ─────────────────────────────────────
  { name: 'cloudflare_api_token', category: 'api_key', regex: /[a-zA-Z0-9_]{40}/, confidence: 0.2 }, // low confidence - too generic alone

  // ─── Generic password assignment ────────────────────
  { name: 'password_assignment', category: 'password', regex: /(?:password|passwd|pwd|secret|token|api_key|apikey)['"]?\s*[=:]\s*['"]?[^\s'"<>]{8,}['"]?/i, confidence: 0.80 },

  // XML-style password: <password>value</password>
  { name: 'xml_password', category: 'password', regex: /<(?:password|secret|token|api[_-]?key)>([^<]{8,})<\//i, confidence: 0.80 },

  // SQL PASSWORD keyword: PASSWORD 'value'
  { name: 'sql_password', category: 'password', regex: /PASSWORD\s+['"]([^'"]{8,})['"]/i, confidence: 0.80 },
];

// Only use patterns with confidence >= threshold (skip very generic ones)
export const ACTIVE_SECRET_PATTERNS = SECRET_PATTERNS.filter(p => p.confidence >= 0.5);

/**
 * Shannon entropy of a string (bits per character).
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) {
    freq.set(c, (freq.get(c) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Hex and base64 character sets for entropy detection
const HEX_RE = /^[a-fA-F0-9]+$/;
const BASE64_RE = /^[a-zA-Z0-9+\/=_-]+$/;

/**
 * Detect high-entropy strings that may be unknown secrets.
 * Scans with a sliding window approach.
 */
export function detectHighEntropyStrings(
  text: string,
  options: { minLength?: number; maxLength?: number; entropyThreshold?: number } = {},
): Array<{ start: number; end: number; entropy: number }> {
  const minLen = options.minLength ?? 20;
  const maxLen = options.maxLength ?? 128;
  const threshold = options.entropyThreshold ?? 4.5;

  const results: Array<{ start: number; end: number; entropy: number }> = [];

  // Find candidate tokens (non-whitespace sequences)
  const tokenRegex = /[^\s,;:(){}\[\]<>"'`]+/g;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const token = match[0];
    if (token.length < minLen || token.length > maxLen) continue;

    // Only consider hex-like or base64-like strings
    if (!HEX_RE.test(token) && !BASE64_RE.test(token)) continue;

    const entropy = shannonEntropy(token);
    if (entropy >= threshold) {
      results.push({
        start: match.index,
        end: match.index + token.length,
        entropy,
      });
    }
  }

  return results;
}
