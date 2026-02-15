/**
 * Database resilience utilities — retry with exponential backoff for transient PG errors.
 */

import { createLogger } from './logger.js';

const log = createLogger('db-resilience');

export interface RetryOptions {
  /** Maximum number of attempts (default 3). */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 100). */
  baseDelayMs?: number;
}

/** PG error codes that are safe to retry. */
const RETRYABLE_CODES = new Set([
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '57P01', // admin_shutdown
]);

function isRetryable(err: unknown): boolean {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    return RETRYABLE_CODES.has((err as { code: string }).code);
  }
  return false;
}

/**
 * Execute `fn` with automatic retry on transient PG errors.
 * Non-retryable errors propagate immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 100;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      log.warn(`Retryable DB error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
        code: (err as { code?: string }).code,
        message: (err as Error).message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable, but TypeScript needs it
  throw lastError;
}
