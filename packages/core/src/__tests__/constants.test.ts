import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_PAYLOAD_SIZE,
  DEFAULT_RETENTION_DAYS,
} from '../constants.js';

describe('Story 2.5: Constants', () => {
  it('should export DEFAULT_PAGE_SIZE as 50', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
  });

  it('should export MAX_PAGE_SIZE as 500', () => {
    expect(MAX_PAGE_SIZE).toBe(500);
  });

  it('should export MAX_PAYLOAD_SIZE as 10240 (10KB)', () => {
    expect(MAX_PAYLOAD_SIZE).toBe(10240);
  });

  it('should export DEFAULT_RETENTION_DAYS as 90', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(90);
  });
});
