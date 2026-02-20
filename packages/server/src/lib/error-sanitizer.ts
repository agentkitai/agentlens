/**
 * Error sanitization utilities — prevents leaking internal details to clients.
 */

const GENERIC_5XX = 'Internal server error';

/**
 * Intentional client-facing error with an explicit HTTP status code.
 * Only messages from ClientError are forwarded to the client for 4xx responses.
 */
export class ClientError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ClientError';
    this.statusCode = statusCode;
  }
}

/**
 * Patterns that must never reach the client (SQLite internals, file paths, stack traces).
 */
const SENSITIVE_PATTERNS = [
  /SQLITE_/i,
  /\/home\//,
  /\/usr\//,
  /\/tmp\//,
  /\\Users\\/,
  /at\s+\S+\s+\(.*:\d+:\d+\)/, // stack trace frames
  /node_modules/,
  /\.ts:\d+/,
  /\.js:\d+/,
];

/**
 * Returns a safe, client-facing error message.
 * - ClientError (4xx): returns the explicit message.
 * - Everything else (5xx): returns generic "Internal server error".
 */
export function sanitizeErrorMessage(err: unknown): string {
  if (err instanceof ClientError && err.statusCode >= 400 && err.statusCode < 500) {
    // L-1 FIX: Defense-in-depth — strip any accidentally leaked sensitive info from 4xx messages
    const msg = err.message;
    if (SENSITIVE_PATTERNS.some((p) => p.test(msg))) {
      return 'Bad request';
    }
    return msg;
  }
  return GENERIC_5XX;
}

// ─── LLM Data Sanitization (Story 18.2) ─────────────────

/** Patterns for secrets that should never reach an LLM */
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,        // OpenAI keys
  /ghp_[a-zA-Z0-9]{36,}/g,       // GitHub PATs
  /gho_[a-zA-Z0-9]{36,}/g,       // GitHub OAuth
  /xoxb-[a-zA-Z0-9-]+/g,         // Slack bot tokens
  /xoxp-[a-zA-Z0-9-]+/g,         // Slack user tokens
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, // Bearer tokens
  /AKIA[0-9A-Z]{16}/g,           // AWS access key IDs
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWTs
];

/** File path patterns */
const PATH_PATTERNS = [
  /\/home\/[^\s"',;)}\]]+/g,
  /\/usr\/[^\s"',;)}\]]+/g,
  /\/tmp\/[^\s"',;)}\]]+/g,
  /\/var\/[^\s"',;)}\]]+/g,
  /[A-Z]:\\Users\\[^\s"',;)}\]]+/g,
  /[A-Z]:\\[^\s"',;)}\]]+/g,
];

/** UUID pattern */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Stack trace frame pattern */
const STACK_FRAME_PATTERN = /^\s*at\s+.+\(.+:\d+:\d+\)\s*$/gm;

/**
 * Sanitize text before sending to an external LLM provider.
 * Replaces (not blocks) sensitive content with safe placeholders.
 * Preserves agent IDs, session IDs, tool names, and cost data.
 */
export function sanitizeForLLM(text: string): string {
  let result = text;

  // Strip stack trace frames
  result = result.replace(STACK_FRAME_PATTERN, '  at <STACK_FRAME>');

  // Replace secrets
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '<SECRET>');
  }

  // Replace file paths
  for (const pattern of PATH_PATTERNS) {
    result = result.replace(pattern, '<PATH>');
  }

  // Replace UUIDs
  result = result.replace(UUID_PATTERN, '<ID>');

  return result;
}

/**
 * Extract HTTP status code from an error, defaulting to 500.
 */
export function getErrorStatus(err: unknown): number {
  if (err instanceof ClientError) return err.statusCode;
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 600) return s;
  }
  return 500;
}
