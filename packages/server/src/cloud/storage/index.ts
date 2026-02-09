/**
 * Storage Adapter — Public API
 */

export type { StorageAdapter, PaginatedResult, StorageBackend } from './adapter.js';
export { getStorageBackend } from './adapter.js';
export { SqliteStorageAdapter } from './sqlite-adapter.js';
export { PostgresStorageAdapter } from './postgres-adapter.js';
