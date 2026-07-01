/**
 * #281 — sessions with no recent activity derive as 'idle' instead of staying
 * 'active' forever, and auto-wake to 'active' when a newer event arrives.
 */
import { describe, it, expect } from 'vitest';
import { deriveSessionStatus, SESSION_IDLE_MS } from '../db/shared/query-helpers.js';

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

describe('session idle derivation (#281)', () => {
  it('is active when the last event is recent', () => {
    expect(deriveSessionStatus('active', iso(now - 1000), iso(now - 10_000))).toBe('active');
  });

  it('is idle when the last event is older than the idle window', () => {
    expect(deriveSessionStatus('active', iso(now - SESSION_IDLE_MS - 60_000), iso(now - SESSION_IDLE_MS))).toBe('idle');
  });

  it('wakes back to active when a newer event arrives', () => {
    // a session that had gone idle, now with a fresh last_event_at
    expect(deriveSessionStatus('active', iso(now), iso(now - SESSION_IDLE_MS - 60_000))).toBe('active');
  });

  it('keeps terminal statuses regardless of age', () => {
    expect(deriveSessionStatus('completed', iso(now - SESSION_IDLE_MS - 1), iso(now))).toBe('completed');
    expect(deriveSessionStatus('error', iso(now - SESSION_IDLE_MS - 1), iso(now))).toBe('error');
  });

  it('falls back to started_at when last_event_at is missing', () => {
    expect(deriveSessionStatus('active', null, iso(now - SESSION_IDLE_MS - 60_000))).toBe('idle');
    expect(deriveSessionStatus('active', undefined, iso(now))).toBe('active');
  });
});
