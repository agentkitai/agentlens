import { describe, it, expect } from 'vitest';
import * as core from '../index.js';

describe('Story 2.5: Index barrel re-exports', () => {
  it('should export all types and constants', () => {
    // Types (runtime arrays)
    expect(core.EVENT_TYPES).toBeDefined();
    expect(core.EVENT_SEVERITIES).toBeDefined();

    // Schemas
    expect(core.eventTypeSchema).toBeDefined();
    expect(core.severitySchema).toBeDefined();
    expect(core.ingestEventSchema).toBeDefined();

    // Hash utilities
    expect(core.computeEventHash).toBeDefined();
    expect(core.verifyChain).toBeDefined();

    // Event helpers
    expect(core.createEvent).toBeDefined();
    expect(core.truncatePayload).toBeDefined();

    // Constants
    expect(core.DEFAULT_PAGE_SIZE).toBe(50);
    expect(core.MAX_PAGE_SIZE).toBe(500);
    expect(core.MAX_PAYLOAD_SIZE).toBe(10240);
    expect(core.DEFAULT_RETENTION_DAYS).toBe(90);
  });

  it('should export createEvent as a function', () => {
    expect(typeof core.createEvent).toBe('function');
  });

  it('should export computeEventHash as a function', () => {
    expect(typeof core.computeEventHash).toBe('function');
  });

  it('should export verifyChain as a function', () => {
    expect(typeof core.verifyChain).toBe('function');
  });
});
