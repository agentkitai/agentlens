/**
 * Brute-force protection: in-memory rate limiter.
 * Locks account after 10 failed attempts in 15 minutes.
 *
 * In production, this would use Redis. For now, in-memory is sufficient
 * for single-instance deployments and testing.
 */

export interface BruteForceConfig {
  maxAttempts: number;      // default 10
  windowMs: number;         // default 15 * 60 * 1000 (15 min)
  lockDurationMs: number;   // default 15 * 60 * 1000 (15 min)
}

interface AttemptRecord {
  attempts: number[];   // timestamps of failed attempts
  lockedUntil: number | null;
}

const DEFAULT_CONFIG: BruteForceConfig = {
  maxAttempts: 10,
  windowMs: 15 * 60 * 1000,
  lockDurationMs: 15 * 60 * 1000,
};

export class BruteForceProtection {
  private records = new Map<string, AttemptRecord>();
  private config: BruteForceConfig;

  constructor(config: Partial<BruteForceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a key (email) is currently locked.
   */
  isLocked(key: string): boolean {
    const record = this.records.get(key);
    if (!record?.lockedUntil) return false;
    if (Date.now() >= record.lockedUntil) {
      // Lock expired, clear
      this.records.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Record a failed attempt. Returns true if account is now locked.
   */
  recordFailure(key: string): boolean {
    const now = Date.now();
    let record = this.records.get(key);
    if (!record) {
      record = { attempts: [], lockedUntil: null };
      this.records.set(key, record);
    }

    // Prune old attempts outside the window
    record.attempts = record.attempts.filter((t) => now - t < this.config.windowMs);
    record.attempts.push(now);

    if (record.attempts.length >= this.config.maxAttempts) {
      record.lockedUntil = now + this.config.lockDurationMs;
      return true;
    }
    return false;
  }

  /**
   * Clear attempts on successful login.
   */
  recordSuccess(key: string): void {
    this.records.delete(key);
  }

  /**
   * Reset all records (for testing).
   */
  reset(): void {
    this.records.clear();
  }
}

/** Singleton instance */
export const bruteForce = new BruteForceProtection();
