/**
 * @agentlens/sdk — Typed Errors
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
 * Thrown when the server is unreachable or returns a 5xx error.
 */
export class ConnectionError extends AgentLensError {
  constructor(message: string, cause?: unknown) {
    super(message, 0, 'CONNECTION_ERROR', cause);
    this.name = 'ConnectionError';
  }
}
