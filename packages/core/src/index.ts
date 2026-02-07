/**
 * @agentlens/core — Public API
 */

// Types
export type {
  EventId,
  Timestamp,
  EventType,
  EventSeverity,
  AgentLensEvent,
  Session,
  Agent,
  EventQuery,
  EventQueryResult,
  SessionQuery,
  AlertCondition,
  AlertRule,
} from './types.js';

// Storage interface
export type {
  IEventStore,
  AnalyticsResult,
  StorageStats,
} from './storage.js';
