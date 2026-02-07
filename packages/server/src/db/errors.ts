/**
 * Custom error types for the storage layer.
 */

/**
 * Thrown when an event batch has forged or mismatched hash values.
 */
export class HashChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashChainError';
  }
}

/**
 * Thrown when an operation targets a resource that does not exist.
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
