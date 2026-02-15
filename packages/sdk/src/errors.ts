/**
 * @agentlensai/sdk — Typed Errors
 */

/**
 * Base error class for all AgentLens SDK errors.
 */
export class AgentLensError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'AgentLensError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thrown when the server returns 401 Unauthorized.
 */
export class AuthenticationError extends AgentLensError {
  constructor(message = 'Authentication failed') {
    super(message, 401, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

/**
 * Thrown when the server returns 404 Not Found.
 */
export class NotFoundError extends AgentLensError {
  constructor(resource: string, id?: string) {
    const msg = id ? `${resource} '${id}' not found` : `${resource} not found`;
    super(msg, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

/**
 * Thrown when the server returns 400 Bad Request (validation errors).
 */
export class ValidationError extends AgentLensError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when the server is unreachable, times out, or returns a network error.
 */
export class ConnectionError extends AgentLensError {
  constructor(message: string, cause?: unknown) {
    super(message, 0, 'CONNECTION_ERROR', cause);
    this.name = 'ConnectionError';
  }
}

/**
 * Thrown when the server returns 429 Too Many Requests.
 */
export class RateLimitError extends AgentLensError {
  public readonly retryAfter: number | null;

  constructor(message = 'Rate limit exceeded', retryAfter: number | null = null) {
    super(message, 429, 'RATE_LIMIT');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when the account quota is exceeded (402 Payment Required).
 */
export class QuotaExceededError extends AgentLensError {
  constructor(message = 'Quota exceeded') {
    super(message, 402, 'QUOTA_EXCEEDED');
    this.name = 'QuotaExceededError';
  }
}

/**
 * Thrown when the server signals backpressure (503 Service Unavailable).
 */
export class BackpressureError extends AgentLensError {
  constructor(message = 'Service unavailable (backpressure)') {
    super(message, 503, 'BACKPRESSURE');
    this.name = 'BackpressureError';
  }
}
