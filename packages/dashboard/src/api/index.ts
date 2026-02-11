/**
 * API Client barrel — re-exports all domain modules for backward compatibility.
 */
export { ApiError, request, toQueryString } from './core';
export * from './events';
export * from './sessions';
export * from './agents';
export * from './analytics';
export * from './alerts';
export * from './guardrails';
export * from './community';
export * from './benchmarks';
export * from './health';
export * from './cost';
export * from './config';
export * from './recall';
export * from './lessons';
export * from './reflect';
export * from './discovery';
export * from './delegations';
