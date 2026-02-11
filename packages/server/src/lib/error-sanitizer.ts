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
