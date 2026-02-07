/**
 * Tests for server configuration (config.ts)
 */
import { describe, it, expect, afterEach } from 'vitest';
import { getConfig } from '../config.js';

describe('getConfig()', () => {
  afterEach(() => {
    delete process.env['RETENTION_DAYS'];
    delete process.env['PORT'];
  });

  it('defaults retentionDays to 90 when RETENTION_DAYS is not set', () => {
    delete process.env['RETENTION_DAYS'];
    const config = getConfig();
    expect(config.retentionDays).toBe(90);
  });

  it('parses RETENTION_DAYS=0 as 0 (keep forever), not 90', () => {
    process.env['RETENTION_DAYS'] = '0';
    const config = getConfig();
    expect(config.retentionDays).toBe(0);
  });

  it('parses RETENTION_DAYS=30 correctly', () => {
    process.env['RETENTION_DAYS'] = '30';
    const config = getConfig();
    expect(config.retentionDays).toBe(30);
  });

  it('falls back to 90 for non-numeric RETENTION_DAYS', () => {
    process.env['RETENTION_DAYS'] = 'abc';
    const config = getConfig();
    expect(config.retentionDays).toBe(90);
  });

  it('falls back to 90 for empty RETENTION_DAYS', () => {
    process.env['RETENTION_DAYS'] = '';
    const config = getConfig();
    expect(config.retentionDays).toBe(90);
  });
});
