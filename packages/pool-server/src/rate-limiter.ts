// Simple in-memory rate limiter with bounded memory

const MAX_ENTRIES = 100_000;
const WARN_THRESHOLD = 50_000;
const CLEANUP_INTERVAL_MS = 60_000;

export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval>;
  private warned = false;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    // Don't keep process alive just for cleanup
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  get size(): number {
    return this.windows.size;
  }

  isAllowed(key: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(key);
    if (!entry || now >= entry.resetAt) {
      // Evict if at capacity
      if (!entry && this.windows.size >= MAX_ENTRIES) {
        this.evict();
      }
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.checkWarnThreshold();
      return true;
    }
    if (entry.count >= this.maxRequests) {
      return false;
    }
    entry.count++;
    return true;
  }

  reset(): void {
    this.windows.clear();
    this.warned = false;
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.windows.clear();
    this.warned = false;
  }

  /** Remove expired entries */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  /** Evict entries when at capacity: expired first, then oldest by insertion order */
  private evict(): void {
    const now = Date.now();
    // First pass: remove expired
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
    // If still at capacity, remove oldest (Map iterates in insertion order)
    if (this.windows.size >= MAX_ENTRIES) {
      const toRemove = this.windows.size - MAX_ENTRIES + 1;
      let removed = 0;
      for (const key of this.windows.keys()) {
        if (removed >= toRemove) break;
        this.windows.delete(key);
        removed++;
      }
    }
  }

  private checkWarnThreshold(): void {
    if (!this.warned && this.windows.size >= WARN_THRESHOLD) {
      this.warned = true;
      console.warn(`[RateLimiter] Warning: ${this.windows.size} entries (threshold: ${WARN_THRESHOLD})`);
    }
  }
}
