/**
 * Storage Adapter — Public API
 */

export type {
  StorageAdapter,
  PaginatedResult,
  StorageBackend,
  AnalyticsQuery,
  CostAnalyticsResult,
  HealthAnalyticsResult,
  TokenUsageResult,
  SearchQuery,
  SearchResult,
} from './adapter.js';
export { getStorageBackend } from './adapter.js';
export { SqliteStorageAdapter } from './sqlite-adapter.js';
export { PostgresStorageAdapter } from './postgres-adapter.js';
