/**
 * @agentlens/sdk — Programmatic client for the AgentLens API
 */

// Client
export { AgentLensClient } from './client.js';
export type {
  AgentLensClientOptions,
  SessionQueryResult,
  TimelineResult,
  HealthResult,
} from './client.js';

// Errors
export {
  AgentLensError,
  AuthenticationError,
  NotFoundError,
  ValidationError,
  ConnectionError,
} from './errors.js';

// Re-export core types consumers will need
export type {
  AgentLensEvent,
  EventQuery,
  EventQueryResult,
  EventType,
  EventSeverity,
  Session,
  SessionQuery,
  SessionStatus,
  Agent,
} from '@agentlens/core';
