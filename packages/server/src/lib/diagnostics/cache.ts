/**
 * Diagnostic Cache (Story 18.6)
 *
 * In-memory TTL cache with LRU eviction for diagnostic results.
 */

import { createHash } from 'node:crypto';
import type { DiagnosticReport } from './types.js';

interface CacheEntry {
  report: DiagnosticReport;
  expiresAt: number;
  lastAccessed: number;
}

export class DiagnosticCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private setCount = 0;

  constructor(
    private readonly ttlMs: number = 15 * 60 * 1000,
    maxEntries = 500,
  ) {
    this.maxEntries = maxEntries;
  }

  /**
   * Generate a cache key from diagnostic parameters.
   */
  static buildKey(type: string, targetId: string, windowDays: number, dataHash: string): string {
    return createHash('sha256')
      .update(`${type}:${targetId}:${windowDays}:${dataHash}`)
      .digest('hex');
  }

  /**
   * Hash arbitrary data for cache key composition.
   */
  static hashData(data: unknown): string {
    return createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  }

  get(key: string): DiagnosticReport | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    entry.lastAccessed = Date.now();
    return entry.report;
  }

  set(key: string, report: DiagnosticReport): void {
    // LRU eviction
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      this.evictOldest();
    }

    this.entries.set(key, {
      report,
      expiresAt: Date.now() + this.ttlMs,
      lastAccessed: Date.now(),
    });

    // Periodic sweep
    this.setCount++;
    if (this.setCount % 100 === 0) {
      this.sweepExpired();
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of this.entries) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now > entry.expiresAt) {
        this.entries.delete(key);
      }
    }
  }
}
